import { describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingProvider, type GeminiEmbedClient } from "@/modules/ai/embedding/gemini";

const clientWith = (impl: GeminiEmbedClient["models"]["embedContent"]): GeminiEmbedClient => ({ models: { embedContent: impl } });
const opts = { kind: "document" as const, model: "gemini-embedding-001" };
const raw = (n: number, hot = 0) => Array.from({ length: n }, (_, i) => (i === hot ? 3 : 4));

describe("GeminiEmbeddingProvider", () => {
  it("envia modelo, textos, tipo de tarefa e 768 dimensões; devolve vetores normalizados", async () => {
    const embedContent = vi.fn().mockResolvedValue({ embeddings: [{ values: raw(768) }, { values: raw(768, 1) }] });
    const p = new GeminiEmbeddingProvider({ apiKey: "k", client: clientWith(embedContent) });
    const out = await p.embed(["um", "dois"], opts);
    const call = embedContent.mock.calls[0][0];
    expect(call.model).toBe("gemini-embedding-001");
    expect(call.contents).toEqual(["um", "dois"]);
    expect(call.config.taskType).toBe("RETRIEVAL_DOCUMENT");
    expect(call.config.outputDimensionality).toBe(768);
    expect(out.vectors).toHaveLength(2);
    expect(Math.hypot(...out.vectors[0])).toBeCloseTo(1);
    expect(out.usage.inputTokens).toBeGreaterThan(0);
  });

  it("pergunta usa RETRIEVAL_QUERY", async () => {
    const embedContent = vi.fn().mockResolvedValue({ embeddings: [{ values: raw(768) }] });
    await new GeminiEmbeddingProvider({ apiKey: "k", client: clientWith(embedContent) }).embed(["x"], { ...opts, kind: "query" });
    expect(embedContent.mock.calls[0][0].config.taskType).toBe("RETRIEVAL_QUERY");
  });

  it("número de vetores diferente do de textos é erro não retentável", async () => {
    const p = new GeminiEmbeddingProvider({ apiKey: "k", client: clientWith(async () => ({ embeddings: [{ values: raw(768) }] })) });
    await expect(p.embed(["a", "b"], opts)).rejects.toMatchObject({ name: "AiError", retryable: false });
  });

  it("vetor com dimensão diferente de 768 é erro", async () => {
    const p = new GeminiEmbeddingProvider({ apiKey: "k", client: clientWith(async () => ({ embeddings: [{ values: raw(3072) }] })) });
    await expect(p.embed(["a"], opts)).rejects.toMatchObject({ retryable: false });
  });

  it.each([
    [429, true],
    [503, true],
    [400, false],
  ])("erro HTTP %i: retentável = %s", async (status, retryable) => {
    const p = new GeminiEmbeddingProvider({
      apiKey: "k",
      client: clientWith(async () => {
        throw Object.assign(new Error("falhou"), { status });
      }),
    });
    await expect(p.embed(["a"], opts)).rejects.toMatchObject({ name: "AiError", retryable });
  });

  it("estouro do tempo limite é retentável", async () => {
    const p = new GeminiEmbeddingProvider({ apiKey: "k", client: clientWith(() => new Promise(() => {})) });
    await expect(p.embed(["a"], { ...opts, timeoutMs: 20 })).rejects.toMatchObject({ retryable: true });
  });
});
