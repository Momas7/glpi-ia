import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicProvider, type AnthropicClient } from "@/modules/ai/provider/anthropic";

const schema = z.object({ ok: z.boolean() });
const req = { system: "sys", user: "usr", schema, model: "claude-haiku-4-5-20251001" };

const clientWith = (impl: AnthropicClient["messages"]["create"]): AnthropicClient => ({ messages: { create: impl } });

describe("AnthropicProvider", () => {
  it("força a ferramenta de saída e valida o tool_use pelo schema", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text" }, { type: "tool_use", input: { ok: true } }],
      usage: { input_tokens: 20, output_tokens: 4 },
    });
    const p = new AnthropicProvider({ apiKey: "k", client: clientWith(create) });
    const out = await p.generate(req);
    expect(out).toEqual({ data: { ok: true }, usage: { inputTokens: 20, outputTokens: 4 } });
    const body = create.mock.calls[0][0];
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([{ role: "user", content: "usr" }]);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toEqual({ type: "tool", name: body.tools[0].name });
  });

  it("resposta sem tool_use ou fora do schema é erro não retentável", async () => {
    const semTool = new AnthropicProvider({ apiKey: "k", client: clientWith(async () => ({ content: [{ type: "text" }] })) });
    await expect(semTool.generate(req)).rejects.toMatchObject({ retryable: false });
    const invalido = new AnthropicProvider({
      apiKey: "k",
      client: clientWith(async () => ({ content: [{ type: "tool_use", input: { ok: 1 } }] })),
    });
    await expect(invalido.generate(req)).rejects.toMatchObject({ retryable: false });
  });

  it.each([
    [429, true],
    [529, true],
    [500, true],
    [400, false],
    [401, false],
  ])("erro HTTP %i: retentável = %s", async (status, retryable) => {
    const p = new AnthropicProvider({
      apiKey: "k",
      client: clientWith(async () => {
        throw Object.assign(new Error("falhou"), { status });
      }),
    });
    await expect(p.generate(req)).rejects.toMatchObject({ name: "AiError", retryable });
  });

  it("estouro do tempo limite é retentável", async () => {
    const p = new AnthropicProvider({ apiKey: "k", client: clientWith(() => new Promise(() => {})) });
    await expect(p.generate({ ...req, timeoutMs: 20 })).rejects.toMatchObject({ retryable: true });
  });
});
