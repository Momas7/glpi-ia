import { estimateCostUsd } from "./pricing";
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

/** Mede o acerto da triagem de um provider contra casos rotulados. Não usa banco; fora do CI porque custa e varia. */
export async function evaluateTriage(
  provider: LLMProvider,
  catalog: TriageCatalog,
  cases: EvalCase[],
  model: string,
): Promise<EvalReport> {
  const categoryName = (id: string | null) => catalog.categories.find((c) => c.id === id)?.name ?? null;
  const teamName = (id: string | null) => catalog.teams.find((t) => t.id === id)?.name ?? null;
  let category = 0;
  let priority = 0;
  let team = 0;
  let cost = 0;
  const failures: EvalReport["failures"] = [];

  for (const c of cases) {
    const prompt = buildTriagePrompt(c, catalog);
    try {
      const res = await provider.generate({ system: prompt.system, user: mask(prompt.user).text, schema: triageOutputSchema, model });
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
