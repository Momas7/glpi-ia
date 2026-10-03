import { createHash } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import type { z } from "zod";
import { getConfig } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import { estimateCostUsd } from "./pricing";
import { mask, unmaskDeep } from "./masking";
import { getLlmProvider } from "./provider/factory";
import type { LLMProvider } from "./provider/types";
import { AiError } from "./types";

export interface AiRequest<T> {
  jobType: string;
  ticketId?: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  model: string;
}

export type AiRunResult<T> = { outcome: "OK"; data: T } | { outcome: "DISABLED" | "BUDGET" };

export interface AiDeps {
  db: Db;
  provider: LLMProvider | null;
  enabled: boolean;
  dailyBudgetUsd: number;
  timezone: string;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

const MAX_ATTEMPTS = 3;
const MAX_STORED_INPUT = 4000;

function defaultDeps(): AiDeps {
  const config = getConfig();
  return {
    db: getDb(),
    provider: getLlmProvider(config),
    enabled: config.AI_ENABLED,
    dailyBudgetUsd: config.AI_DAILY_BUDGET,
    timezone: config.APP_TIMEZONE,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
  };
}

const DEP_KEYS: (keyof AiDeps)[] = ["db", "provider", "enabled", "dailyBudgetUsd", "timezone", "sleep", "now"];

/** Só lê a configuração do ambiente quando os testes não injetaram tudo. */
function resolveDeps(overrides: Partial<AiDeps>): AiDeps {
  return DEP_KEYS.every((k) => k in overrides) ? (overrides as AiDeps) : { ...defaultDeps(), ...overrides };
}

function startOfDay(now: Date, timezone: string): Date {
  const d = new TZDate(now, timezone);
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime());
}

/**
 * Único ponto de saída para um LLM: confere liga/desliga e teto de gasto, mascara a entrada,
 * tenta de novo só em erro temporário, desmascara a saída e audita cada chamada.
 */
export async function runAi<T>(req: AiRequest<T>, overrides: Partial<AiDeps> = {}): Promise<AiRunResult<T>> {
  const deps = resolveDeps(overrides);
  const { db, provider } = deps;
  if (!deps.enabled || !provider) return { outcome: "DISABLED" };

  const masked = mask(req.user);
  const base = {
    provider: provider.name,
    model: req.model,
    jobType: req.jobType,
    ticketId: req.ticketId ?? null,
    inputHash: createHash("sha256").update(masked.text).digest("hex"),
    maskedInput: masked.text.slice(0, MAX_STORED_INPUT),
  };

  const spent = await db.aiAuditLog.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: startOfDay(deps.now(), deps.timezone) } },
  });
  if (Number(spent._sum.costUsd ?? 0) >= deps.dailyBudgetUsd) {
    await db.aiAuditLog.create({
      data: { ...base, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, outcome: "BUDGET" },
    });
    return { outcome: "BUDGET" };
  }

  const started = Date.now();
  let lastError: AiError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await provider.generate({ system: req.system, user: masked.text, schema: req.schema, model: req.model });
      const data = unmaskDeep(result.data, masked.map);
      await db.aiAuditLog.create({
        data: {
          ...base,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costUsd: estimateCostUsd(req.model, result.usage.inputTokens, result.usage.outputTokens),
          latencyMs: Date.now() - started,
          outcome: "OK",
        },
      });
      return { outcome: "OK", data };
    } catch (err) {
      lastError = err instanceof AiError ? err : new AiError(err instanceof Error ? err.message : "falha na IA", false, { cause: err });
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
      await deps.sleep(1000 * 2 ** (attempt - 1));
    }
  }
  const error = lastError ?? new AiError("falha na IA", false);
  await db.aiAuditLog.create({
    data: {
      ...base,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - started,
      outcome: "FAILED",
      error: error.message.slice(0, 500),
    },
  });
  throw error;
}

/** Apaga o texto mascarado guardado há mais que a retenção; as métricas da linha permanecem. */
export async function cleanupAuditInputs(
  retentionDays: number,
  deps: { db?: Db; now?: Date } = {},
): Promise<number> {
  const db = deps.db ?? getDb();
  const limit = new Date((deps.now ?? new Date()).getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await db.aiAuditLog.updateMany({
    where: { createdAt: { lt: limit }, maskedInput: { not: null } },
    data: { maskedInput: null },
  });
  return count;
}
