/**
 * Mede a busca do RAG: a fonte certa aparece no top 3? Perguntas sem artigo ficam abaixo do limiar?
 * Uso: npm run ai:eval:rag   (usa EMBEDDING_PROVIDER e a chave do .env; com "fake" só valida o script).
 * Fora do CI: chama o provider de embeddings escolhido, gasta cota e o resultado varia.
 */
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/lib/config";
import { evaluateRetrieval, getEmbeddingProvider, type EmbedFn, type RagCase } from "../src/modules/ai";

const config = loadConfig({
  DATABASE_URL: "postgresql://nao-usado",
  SESSION_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
  ...process.env,
});
const provider = getEmbeddingProvider(config);
if (!provider) {
  console.error(`Sem chave de API para o provider de embeddings "${config.EMBEDDING_PROVIDER}". Defina a chave no .env ou use EMBEDDING_PROVIDER=fake.`);
  process.exit(1);
}

const articles = JSON.parse(readFileSync("tests/ai-eval/rag-articles.json", "utf8")) as { title: string; body: string }[];
const cases = JSON.parse(readFileSync("tests/ai-eval/rag-questions.json", "utf8")) as RagCase[];

// Planos gratuitos limitam as chamadas por minuto: lotes pequenos, pausa entre eles e nova tentativa em erro temporário.
const batchSize = Number(process.env.AI_EVAL_BATCH ?? 20);
const delayMs = Number(process.env.AI_EVAL_DELAY_MS ?? (provider.name === "fake" ? 0 : 8000));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let tokens = 0;

const embed: EmbedFn = async (texts, kind) => {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    if (i > 0 && delayMs) await sleep(delayMs);
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await provider.embed(texts.slice(i, i + batchSize), { kind, model: config.AI_EMBEDDING_MODEL });
        tokens += res.usage.inputTokens;
        out.push(...res.vectors);
        break;
      } catch (err) {
        const retryable = (err as { retryable?: boolean })?.retryable === true;
        if (!retryable || attempt >= 4) throw err;
        await sleep(10_000 * 2 ** (attempt - 1));
      }
    }
  }
  return out;
};

const report = await evaluateRetrieval(embed, articles, cases, { k: 3, minSimilarity: config.AI_RAG_MIN_SIMILARITY });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(`Provider: ${provider.name} · modelo: ${config.AI_EMBEDDING_MODEL} · limiar: ${config.AI_RAG_MIN_SIMILARITY}`);
console.log(`Perguntas: ${report.total} (${report.answerable} com artigo, ${report.unanswerable} sem)`);
console.log(`Fonte certa no top 3: ${pct(report.recallAtK)} · sem artigo e sem fonte acima do limiar: ${report.rejectedCorrectly}/${report.unanswerable}`);
console.log(`Tokens de entrada: ${tokens}`);
if (report.failures.length > 0) {
  console.log(`\nErros (${report.failures.length}):`);
  for (const f of report.failures) console.log(`- ${f.question}\n    esperado: ${f.expected || "(nenhum)"}\n    veio:     ${f.got.join(" | ") || "(nada acima do limiar)"}`);
}
