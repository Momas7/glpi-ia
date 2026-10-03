import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDb, type Db } from "@/lib/db";
import { FakeLLMProvider } from "@/modules/ai/provider/fake";
import type { AiDeps } from "@/modules/ai/run";
import { AiError } from "@/modules/ai/types";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let run: typeof import("@/modules/ai/run");

beforeAll(async () => {
  testDb = await startTestDb();
  db = createDb(testDb.url);
  run = await import("@/modules/ai/run");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.aiAuditLog.deleteMany();
});

const schema = z.object({ answer: z.string() });
const NOW = new Date("2026-10-03T15:00:00Z");

const deps = (over: Partial<AiDeps> = {}): AiDeps => ({
  db,
  provider: new FakeLLMProvider(() => ({ answer: "ok" })),
  enabled: true,
  dailyBudgetUsd: 5,
  timezone: "America/Sao_Paulo",
  sleep: async () => {},
  now: () => NOW,
  ...over,
});

const request = (user = "texto") => ({ jobType: "triage", system: "sys", user, schema, model: "claude-haiku-4-5-20251001" });

describe("runAi", () => {
  it("desligada: devolve DISABLED sem auditar nem chamar o provider", async () => {
    const generate = vi.fn();
    const out = await run.runAi(request(), deps({ enabled: false, provider: { name: "fake", generate } }));
    expect(out).toEqual({ outcome: "DISABLED" });
    expect(generate).not.toHaveBeenCalled();
    expect(await db.aiAuditLog.count()).toBe(0);
  });

  it("sem provider (chave ausente) devolve DISABLED", async () => {
    expect(await run.runAi(request(), deps({ provider: null }))).toEqual({ outcome: "DISABLED" });
  });

  it("sucesso grava uma linha OK com texto mascarado e hash", async () => {
    const out = await run.runAi(request("fale com ana@empresa.com"), deps());
    expect(out).toEqual({ outcome: "OK", data: { answer: "ok" } });
    const rows = await db.aiAuditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "OK", jobType: "triage", provider: "fake", model: "claude-haiku-4-5-20251001" });
    expect(rows[0].maskedInput).toContain("[EMAIL_1]");
    expect(rows[0].maskedInput).not.toContain("ana@empresa.com");
    expect(rows[0].inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].inputTokens).toBeGreaterThan(0);
  });

  it("o provider recebe o texto mascarado e a saída volta desmascarada", async () => {
    let seen = "";
    const provider = new FakeLLMProvider(({ user }) => {
      seen = user;
      return { answer: "responda para [EMAIL_1]" };
    });
    const out = await run.runAi(request("fale com ana@empresa.com"), deps({ provider }));
    expect(seen).toBe("fale com [EMAIL_1]");
    expect(out).toEqual({ outcome: "OK", data: { answer: "responda para ana@empresa.com" } });
  });

  it("erro retentável duas vezes e sucesso na terceira: espera 1 s e 2 s", async () => {
    let calls = 0;
    const provider = new FakeLLMProvider(() => {
      if (++calls < 3) throw new AiError("429", true);
      return { answer: "ok" };
    });
    const sleep = vi.fn(async () => {});
    const out = await run.runAi(request(), deps({ provider, sleep }));
    expect(out.outcome).toBe("OK");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(await db.aiAuditLog.count()).toBe(1);
  });

  it("erro não retentável lança na hora e grava FAILED", async () => {
    let calls = 0;
    const provider = new FakeLLMProvider(() => {
      calls++;
      throw new AiError("chave inválida", false);
    });
    await expect(run.runAi(request(), deps({ provider }))).rejects.toMatchObject({ name: "AiError", retryable: false });
    expect(calls).toBe(1);
    const row = await db.aiAuditLog.findFirstOrThrow();
    expect(row).toMatchObject({ outcome: "FAILED", error: "chave inválida" });
  });

  it("três erros retentáveis: lança e grava uma única linha FAILED", async () => {
    const provider = new FakeLLMProvider(() => {
      throw new AiError("503", true);
    });
    await expect(run.runAi(request(), deps({ provider }))).rejects.toBeInstanceOf(AiError);
    expect(await db.aiAuditLog.count({ where: { outcome: "FAILED" } })).toBe(1);
  });

  it("gasto do dia no teto: BUDGET, sem chamar o provider; gasto de ontem não conta", async () => {
    const base = { provider: "fake", model: "m", jobType: "triage", inputTokens: 1, outputTokens: 1, latencyMs: 1, inputHash: "h", outcome: "OK" as const };
    await db.aiAuditLog.create({ data: { ...base, costUsd: "9.000000", createdAt: new Date("2026-10-02T12:00:00Z") } });
    const generate = vi.fn();
    const ontem = await run.runAi(request(), deps({ provider: new FakeLLMProvider(() => ({ answer: "ok" })) }));
    expect(ontem.outcome).toBe("OK");

    await db.aiAuditLog.deleteMany();
    await db.aiAuditLog.create({ data: { ...base, costUsd: "5.000000", createdAt: new Date("2026-10-03T13:00:00Z") } });
    const out = await run.runAi(request(), deps({ provider: { name: "fake", generate } }));
    expect(out).toEqual({ outcome: "BUDGET" });
    expect(generate).not.toHaveBeenCalled();
    expect(await db.aiAuditLog.count({ where: { outcome: "BUDGET" } })).toBe(1);
  });

  it("cleanupAuditInputs apaga o texto mascarado vencido e mantém o recente", async () => {
    const base = { provider: "fake", model: "m", jobType: "triage", inputTokens: 1, outputTokens: 1, latencyMs: 1, inputHash: "h", outcome: "OK" as const, costUsd: "0", maskedInput: "texto" };
    await db.aiAuditLog.create({ data: { ...base, createdAt: new Date("2026-09-02T00:00:00Z") } });
    await db.aiAuditLog.create({ data: { ...base, createdAt: new Date("2026-09-04T00:00:00Z") } });
    const cleaned = await run.cleanupAuditInputs(30, { db, now: NOW });
    expect(cleaned).toBe(1);
    const rows = await db.aiAuditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.maskedInput)).toEqual([null, "texto"]);
  });
});
