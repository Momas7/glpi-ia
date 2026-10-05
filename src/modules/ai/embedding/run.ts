import { createHash } from "node:crypto";
import { getConfig } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import { mask } from "../masking";
import { estimateCostUsd } from "../pricing";
import { startOfDay } from "../run";
import { AiError } from "../types";
import { getEmbeddingProvider } from "./factory";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "./types";

export interface EmbedRequest {
  jobType: string;
  ticketId?: string;
  texts: string[];
  kind: "document" | "query";
}

export type EmbedResult = { outcome: "OK"; vectors: number[][] } | { outcome: "DISABLED" | "BUDGET" };

export interface EmbedDeps {
  db: Db;
  provider: EmbeddingProvider | null;
  enabled: boolean;
  dailyBudgetUsd: number;
  timezone: string;
  model: string;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

const MAX_ATTEMPTS = 3;
const MAX_STORED_INPUT = 4000;
const DEP_KEYS: (keyof EmbedDeps)[] = ["db", "provider", "enabled", "dailyBudgetUsd", "timezone", "model", "sleep", "now"];

function defaultDeps(): EmbedDeps {
  const config = getConfig();
  return {
    db: getDb(),
    provider: getEmbeddingProvider(config),
    enabled: config.AI_ENABLED,
    dailyBudgetUsd: config.AI_DAILY_BUDGET,
    timezone: config.APP_TIMEZONE,
    model: config.AI_EMBEDDING_MODEL,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
  };
}

/**
 * Único ponto de saída para um provider de embeddings: liga/desliga, teto de gasto, máscara de cada texto,
 * retry só em erro temporário e auditoria. Nunca devolve vetor com dimensão diferente de 768.
 */
export async function runEmbed(req: EmbedRequest, overrides: Partial<EmbedDeps> = {}): Promise<EmbedResult> {
  const deps: EmbedDeps = DEP_KEYS.every((k) => k in overrides) ? (overrides as EmbedDeps) : { ...defaultDeps(), ...overrides };
  const { db, provider } = deps;
  if (!deps.enabled || !provider) return { outcome: "DISABLED" };

  const maskedTexts = req.texts.map((t) => mask(t).text);
  const joined = maskedTexts.join("\n---\n");
  const base = {
    provider: provider.name,
    model: deps.model,
    jobType: req.jobType,
    ticketId: req.ticketId ?? null,
    inputHash: createHash("sha256").update(joined).digest("hex"),
    maskedInput: joined.slice(0, MAX_STORED_INPUT),
  };

  const spent = await db.aiAuditLog.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: startOfDay(deps.now(), deps.timezone) } },
  });
  if (Number(spent._sum.costUsd ?? 0) >= deps.dailyBudgetUsd) {
    await db.aiAuditLog.create({ data: { ...base, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, outcome: "BUDGET" } });
    return { outcome: "BUDGET" };
  }

  const started = Date.now();
  let lastError: AiError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await provider.embed(maskedTexts, { kind: req.kind, model: deps.model });
      if (res.vectors.length !== maskedTexts.length || res.vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new AiError("o provider devolveu vetores fora do formato esperado (768 dimensões, um por texto)", false);
      }
      await db.aiAuditLog.create({
        data: {
          ...base,
          inputTokens: res.usage.inputTokens,
          outputTokens: 0,
          costUsd: estimateCostUsd(deps.model, res.usage.inputTokens, 0),
          latencyMs: Date.now() - started,
          outcome: "OK",
        },
      });
      return { outcome: "OK", vectors: res.vectors };
    } catch (err) {
      lastError = err instanceof AiError ? err : new AiError(err instanceof Error ? err.message : "falha no embedding", false, { cause: err });
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
      await deps.sleep(1000 * 2 ** (attempt - 1));
    }
  }
  const error = lastError ?? new AiError("falha no embedding", false);
  await db.aiAuditLog.create({
    data: { ...base, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: Date.now() - started, outcome: "FAILED", error: error.message.slice(0, 500) },
  });
  throw error;
}
