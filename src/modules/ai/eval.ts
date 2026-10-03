import { chunkText } from "./chunking";
import { estimateCostUsd } from "./pricing";
import { AiError } from "./types";
import { mask } from "./masking";
import type { LLMProvider } from "./provider/types";
import { buildTriagePrompt, triageOutputSchema, type TriageCatalog } from "./triage";

export interface EvalCase {
  title: string;
  description: string;
  /** Nomes (não ids), para o conjunto valer em qualquer banco. `null` = nenhuma opção serve. */
  expected: { category: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; team: string | null };
}

export interface EvalReport {
  total: number;
  categoryAccuracy: number;
  priorityAccuracy: number;
  teamAccuracy: number;
  costUsd: number;
  failures: { title: string; expected: EvalCase["expected"]; got: unknown }[];
}

export interface EvalOptions {
  /** Pausa entre os casos (planos gratuitos limitam as chamadas por minuto). */
  delayMs?: number;
  /** Espera da 1ª nova tentativa em erro temporário; dobra a cada tentativa (máx. 4 no total). */
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const EVAL_MAX_ATTEMPTS = 4;

/** Mede o acerto da triagem de um provider contra casos rotulados. Não usa banco; fora do CI porque custa e varia. */
export async function evaluateTriage(
  provider: LLMProvider,
  catalog: TriageCatalog,
  cases: EvalCase[],
  model: string,
  options: EvalOptions = {},
): Promise<EvalReport> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryBaseMs = options.retryBaseMs ?? 10_000;
  const categoryName = (id: string | null) => catalog.categories.find((c) => c.id === id)?.name ?? null;
  const teamName = (id: string | null) => catalog.teams.find((t) => t.id === id)?.name ?? null;
  let category = 0;
  let priority = 0;
  let team = 0;
  let cost = 0;
  const failures: EvalReport["failures"] = [];

  for (const [index, c] of cases.entries()) {
    if (index > 0 && options.delayMs) await sleep(options.delayMs);
    const prompt = buildTriagePrompt(c, catalog);
    try {
      let res: Awaited<ReturnType<typeof provider.generate<typeof triageOutputSchema._output>>> | undefined;
      for (let attempt = 1; !res; attempt++) {
        try {
          res = await provider.generate({ system: prompt.system, user: mask(prompt.user).text, schema: triageOutputSchema, model });
        } catch (err) {
          if (!(err instanceof AiError && err.retryable) || attempt >= EVAL_MAX_ATTEMPTS) throw err;
          await sleep(retryBaseMs * 2 ** (attempt - 1));
        }
      }
      cost += estimateCostUsd(model, res.usage.inputTokens, res.usage.outputTokens);
      const got = { category: categoryName(res.data.categoryId), priority: res.data.priority, team: teamName(res.data.teamId) };
      const okCategory = got.category === c.expected.category;
      const okPriority = got.priority === c.expected.priority;
      const okTeam = got.team === c.expected.team;
      if (okCategory) category++;
      if (okPriority) priority++;
      if (okTeam) team++;
      if (!(okCategory && okPriority && okTeam)) failures.push({ title: c.title, expected: c.expected, got });
    } catch (err) {
      failures.push({ title: c.title, expected: c.expected, got: err instanceof Error ? err.message : "erro" });
    }
  }
  const n = cases.length || 1;
  return {
    total: cases.length,
    categoryAccuracy: category / n,
    priorityAccuracy: priority / n,
    teamAccuracy: team / n,
    costUsd: cost,
    failures,
  };
}

export interface RagCase {
  question: string;
  /** Título do artigo que deve aparecer; `""` = nenhum artigo responde (nada pode passar do limiar). */
  expectedArticle: string;
}

export interface RagReport {
  total: number;
  answerable: number;
  unanswerable: number;
  recallAtK: number;
  rejectedCorrectly: number;
  failures: { question: string; expected: string; got: string[] }[];
}

/** Embeds `texts` com o provider escolhido; o chamador decide lotes e pausas (cota do plano). */
export type EmbedFn = (texts: string[], kind: "document" | "query") => Promise<number[][]>;

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

/**
 * Mede se a busca acha o artigo certo no top-k (recall) e se perguntas sem resposta ficam abaixo do limiar.
 * Índice em memória (trechos de `chunkText`), sem banco; os vetores já vêm normalizados, então cosseno = produto escalar.
 */
export async function evaluateRetrieval(
  embed: EmbedFn,
  articles: { title: string; body: string }[],
  cases: RagCase[],
  opts: { k?: number; minSimilarity?: number } = {},
): Promise<RagReport> {
  const k = opts.k ?? 3;
  const minSimilarity = opts.minSimilarity ?? 0.6;
  const chunks = articles.flatMap((a) => chunkText(`${a.title}\n\n${a.body}`).map((text) => ({ title: a.title, text })));
  const chunkVectors = await embed(chunks.map((c) => c.text), "document");
  const questionVectors = await embed(cases.map((c) => c.question), "query");

  let answerable = 0;
  let unanswerable = 0;
  let hits = 0;
  let rejected = 0;
  const failures: RagReport["failures"] = [];

  for (const [i, c] of cases.entries()) {
    const scored = chunks
      .map((chunk, j) => ({ title: chunk.title, sim: dot(questionVectors[i], chunkVectors[j]) }))
      .sort((x, y) => y.sim - x.sim);
    const got = scored.filter((s, idx) => scored.findIndex((o) => o.title === s.title) === idx && s.sim >= minSimilarity).slice(0, k).map((s) => s.title);

    if (c.expectedArticle === "") {
      unanswerable++;
      if (got.length === 0) rejected++;
      else failures.push({ question: c.question, expected: "", got });
    } else {
      answerable++;
      // O limiar também vale aqui no uso real; para medir só o ranking use minSimilarity baixo.
      const ranked = scored.filter((s, idx) => scored.findIndex((o) => o.title === s.title) === idx).slice(0, k).map((s) => s.title);
      if (ranked.includes(c.expectedArticle) && got.includes(c.expectedArticle)) hits++;
      else failures.push({ question: c.question, expected: c.expectedArticle, got: ranked });
    }
  }
  return {
    total: cases.length,
    answerable,
    unanswerable,
    recallAtK: answerable === 0 ? 0 : hits / answerable,
    rejectedCorrectly: rejected,
    failures,
  };
}
