/**
 * Mede o acerto da triagem contra o conjunto rotulado em tests/ai-eval/dataset.json.
 * Uso: npm run ai:eval   (usa LLM_PROVIDER e as chaves do .env; com "fake" não gasta nada).
 * Fora do CI de propósito: chama o provider escolhido, custa dinheiro e o resultado varia.
 */
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/lib/config";
import { defaultTriageModel, evaluateTriage, getLlmProvider, type EvalCase } from "../src/modules/ai";

const config = loadConfig({
  DATABASE_URL: "postgresql://nao-usado",
  SESSION_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
  ...process.env,
});
const provider = getLlmProvider(config);
if (!provider) {
  console.error(`Sem chave de API para o provider "${config.LLM_PROVIDER}". Defina a chave no .env ou use LLM_PROVIDER=fake.`);
  process.exit(1);
}

// Mesmo catálogo do seed (prisma/seed.ts); ids = nomes porque o conjunto é rotulado por nome.
const teams = ["Infraestrutura", "Suporte N1", "Sistemas"].map((name) => ({ id: name, name }));
const categories = [
  { id: "Hardware", name: "Hardware", defaultTeamId: "Infraestrutura" },
  { id: "Software", name: "Software", defaultTeamId: "Sistemas" },
  { id: "Rede", name: "Rede", defaultTeamId: "Infraestrutura" },
  { id: "Acessos", name: "Acessos", defaultTeamId: "Suporte N1" },
];

const cases = JSON.parse(readFileSync("tests/ai-eval/dataset.json", "utf8")) as EvalCase[];
const model = config.AI_MODEL_TRIAGE ?? defaultTriageModel(provider.name);
// Pausa entre os casos para caber no limite por minuto dos planos gratuitos (AI_EVAL_DELAY_MS=0 para desligar).
const delayMs = Number(process.env.AI_EVAL_DELAY_MS ?? (provider.name === "fake" ? 0 : 6000));
const report = await evaluateTriage(provider, { categories, teams }, cases, model, { delayMs });

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(`Provider: ${provider.name} · modelo: ${model} · casos: ${report.total}`);
console.log(`Categoria: ${pct(report.categoryAccuracy)} · Prioridade: ${pct(report.priorityAccuracy)} · Equipe: ${pct(report.teamAccuracy)}`);
console.log(`Custo estimado: US$ ${report.costUsd.toFixed(4)}`);
if (report.failures.length > 0) {
  console.log(`\nErros (${report.failures.length}):`);
  for (const f of report.failures) console.log(`- ${f.title}\n    esperado: ${JSON.stringify(f.expected)}\n    obtido:   ${JSON.stringify(f.got)}`);
}
