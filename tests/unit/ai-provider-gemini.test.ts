import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiProvider, type GeminiClient } from "@/modules/ai/provider/gemini";

const schema = z.object({ ok: z.boolean() });
const req = { system: "sys", user: "usr", schema, model: "gemini-2.5-flash" };

const clientWith = (impl: GeminiClient["models"]["generateContent"]): GeminiClient => ({ models: { generateContent: impl } });

describe("GeminiProvider", () => {
  it("envia modelo, instrução de sistema e JSON; devolve dados e tokens", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"ok":true}',
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
    });
    const p = new GeminiProvider({ apiKey: "k", client: clientWith(generateContent) });
    const out = await p.generate(req);
    expect(out).toEqual({ data: { ok: true }, usage: { inputTokens: 12, outputTokens: 3 } });
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe("gemini-2.5-flash");
    expect(call.contents).toBe("usr");
    expect(call.config.systemInstruction).toBe("sys");
    expect(call.config.responseMimeType).toBe("application/json");
  });

  it("JSON que não bate no schema vira erro não retentável", async () => {
    const p = new GeminiProvider({ apiKey: "k", client: clientWith(async () => ({ text: '{"ok":"sim"}' })) });
    await expect(p.generate(req)).rejects.toMatchObject({ name: "AiError", retryable: false });
  });

  it("texto que não é JSON vira erro não retentável", async () => {
    const p = new GeminiProvider({ apiKey: "k", client: clientWith(async () => ({ text: "desculpe" })) });
    await expect(p.generate(req)).rejects.toMatchObject({ retryable: false });
  });

  it.each([
    [429, true],
    [503, true],
    [400, false],
    [401, false],
  ])("erro HTTP %i: retentável = %s", async (status, retryable) => {
    const p = new GeminiProvider({
      apiKey: "k",
      client: clientWith(async () => {
        throw Object.assign(new Error("falhou"), { status });
      }),
    });
    await expect(p.generate(req)).rejects.toMatchObject({ name: "AiError", retryable });
  });

  it("erro de rede (sem status) é retentável", async () => {
    const p = new GeminiProvider({
      apiKey: "k",
      client: clientWith(async () => {
        throw new Error("ECONNRESET");
      }),
    });
    await expect(p.generate(req)).rejects.toMatchObject({ retryable: true });
  });

  it("estouro do tempo limite é retentável", async () => {
    const p = new GeminiProvider({ apiKey: "k", client: clientWith(() => new Promise(() => {})) });
    await expect(p.generate({ ...req, timeoutMs: 20 })).rejects.toMatchObject({ retryable: true, message: /tempo esgotado/ });
  });
});
