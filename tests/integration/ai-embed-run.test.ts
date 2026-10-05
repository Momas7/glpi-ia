import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";
import type { EmbedDeps } from "@/modules/ai/embedding/run";
import type { EmbeddingProvider } from "@/modules/ai/embedding/types";
import { AiError } from "@/modules/ai/types";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let run: typeof import("@/modules/ai/embedding/run");

beforeAll(async () => {
  testDb = await startTestDb();
  db = createDb(testDb.url);
  run = await import("@/modules/ai/embedding/run");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.aiAuditLog.deleteMany();
});

const deps = (over: Partial<EmbedDeps> = {}): EmbedDeps => ({
  db,
  provider: new FakeEmbeddingProvider(),
  enabled: true,
  dailyBudgetUsd: 5,
  timezone: "America/Sao_Paulo",
  model: "gemini-embedding-001",
  sleep: async () => {},
  now: () => new Date("2026-10-03T15:00:00Z"),
  ...over,
});

const request = (texts = ["fale com ana@empresa.com"]) => ({ jobType: "embed", texts, kind: "document" as const });

describe("runEmbed", () => {
  it("desligado ou sem provider: DISABLED sem auditar", async () => {
    expect(await run.runEmbed(request(), deps({ enabled: false }))).toEqual({ outcome: "DISABLED" });
    expect(await run.runEmbed(request(), deps({ provider: null }))).toEqual({ outcome: "DISABLED" });
    expect(await db.aiAuditLog.count()).toBe(0);
  });

  it("sucesso: o provider recebe texto mascarado e uma linha de auditoria é gravada", async () => {
    let seen: string[] = [];
    const provider: EmbeddingProvider = {
      name: "fake",
      embed: async (texts, o) => {
        seen = texts;
        return new FakeEmbeddingProvider().embed(texts, o);
      },
    };
    const out = await run.runEmbed(request(["fale com ana@empresa.com", "CPF 123.456.789-09"]), deps({ provider }));
    expect(out.outcome).toBe("OK");
    if (out.outcome === "OK") expect(out.vectors).toHaveLength(2);
    expect(seen).toEqual(["fale com [EMAIL_1]", "CPF [CPF_1]"]);
    const row = await db.aiAuditLog.findFirstOrThrow();
    expect(row).toMatchObject({ jobType: "embed", outcome: "OK", model: "gemini-embedding-001" });
    expect(row.maskedInput).not.toContain("ana@empresa.com");
    expect(row.inputTokens).toBeGreaterThan(0);
  });

  it("erro retentável duas vezes e sucesso na terceira: espera 1 s e 2 s", async () => {
    let calls = 0;
    const provider: EmbeddingProvider = {
      name: "fake",
      embed: async (texts, o) => {
        if (++calls < 3) throw new AiError("429", true);
        return new FakeEmbeddingProvider().embed(texts, o);
      },
    };
    const sleep = vi.fn(async (_ms: number) => {});
    expect((await run.runEmbed(request(), deps({ provider, sleep }))).outcome).toBe("OK");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("erro não retentável lança e grava FAILED", async () => {
    const provider: EmbeddingProvider = {
      name: "fake",
      embed: async () => {
        throw new AiError("chave inválida", false);
      },
    };
    await expect(run.runEmbed(request(), deps({ provider }))).rejects.toMatchObject({ retryable: false });
    expect(await db.aiAuditLog.count({ where: { outcome: "FAILED", jobType: "embed" } })).toBe(1);
  });

  it("teto estourado: BUDGET sem chamar o provider", async () => {
    await db.aiAuditLog.create({
      data: { provider: "fake", model: "m", jobType: "embed", inputTokens: 1, outputTokens: 0, costUsd: "5", latencyMs: 1, inputHash: "h", outcome: "OK", createdAt: new Date("2026-10-03T13:00:00Z") },
    });
    const embed = vi.fn();
    expect(await run.runEmbed(request(), deps({ provider: { name: "fake", embed } }))).toEqual({ outcome: "BUDGET" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("vetor com dimensão errada ou quantidade errada vira erro e nada é devolvido", async () => {
    const wrongDims: EmbeddingProvider = { name: "fake", embed: async () => ({ vectors: [[1, 2, 3]], usage: { inputTokens: 1 } }) };
    await expect(run.runEmbed(request(), deps({ provider: wrongDims }))).rejects.toMatchObject({ retryable: false });
    const wrongCount: EmbeddingProvider = { name: "fake", embed: async () => ({ vectors: [], usage: { inputTokens: 1 } }) };
    await expect(run.runEmbed(request(), deps({ provider: wrongCount }))).rejects.toMatchObject({ retryable: false });
  });
});
