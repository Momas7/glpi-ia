/**
 * Calibra o limiar de duplicados e de incidente: quantos duplicados o limiar pega e quantos falsos alarmes gera.
 * Uso: npm run ai:eval:dup   (usa EMBEDDING_PROVIDER e a chave do .env; com "fake" só valida o script).
 * Fora do CI: chama o provider de embeddings escolhido, gasta cota e o resultado varia.
 */
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/lib/config";
import { evaluateDuplicates, getEmbeddingProvider, type DupPair, type EmbedFn } from "../src/modules/ai";

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

const pairs = JSON.parse(readFileSync("tests/ai-eval/dup-pairs.json", "utf8")) as DupPair[];
const batchSize = Number(process.env.AI_EVAL_BATCH ?? 20);
const delayMs = Number(process.env.AI_EVAL_DELAY_MS ?? (provider.name === "fake" ? 0 : 8000));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const embed: EmbedFn = async (texts, kind) => {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    if (i > 0 && delayMs) await sleep(delayMs);
    for (let attempt = 1; ; attempt++) {
      try {
        out.push(...(await provider.embed(texts.slice(i, i + batchSize), { kind, model: config.AI_EMBEDDING_MODEL })).vectors);
        break;
      } catch (err) {
        if ((err as { retryable?: boolean })?.retryable !== true || attempt >= 4) throw err;
        await sleep(10_000 * 2 ** (attempt - 1));
      }
    }
  }
  return out;
};

const threshold = config.AI_DUPLICATE_MIN_SIMILARITY;
const r = await evaluateDuplicates(embed, pairs, { threshold });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(`Provider: ${provider.name} · modelo: ${config.AI_EMBEDDING_MODEL} · pares: ${r.total}`);
console.log(`Com o limiar atual (${threshold}): precisão ${pct(r.precision)} · duplicados pegos (recall) ${pct(r.recall)}`);
console.log(`Limiar sugerido (melhor F1): ${r.suggestedThreshold.toFixed(2)}`);
if (r.falsePositives.length) {
  console.log(`\nFalsos alarmes (${r.falsePositives.length}):`);
  for (const p of r.falsePositives) console.log(`- "${p.a}"  ×  "${p.b}"`);
}
if (r.missed.length) {
  console.log(`\nDuplicados perdidos (${r.missed.length}):`);
  for (const p of r.missed) console.log(`- "${p.a}"  ×  "${p.b}"`);
}
