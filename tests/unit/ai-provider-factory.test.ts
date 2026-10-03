import { describe, expect, it } from "vitest";
import { getLlmProvider } from "@/modules/ai/provider/factory";

describe("getLlmProvider", () => {
  it("fake não precisa de chave", () => {
    expect(getLlmProvider({ LLM_PROVIDER: "fake" })?.name).toBe("fake");
  });
  it("gemini sem chave devolve null; com chave devolve o provider", () => {
    expect(getLlmProvider({ LLM_PROVIDER: "gemini" })).toBeNull();
    expect(getLlmProvider({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" })?.name).toBe("gemini");
  });
  it("anthropic sem chave devolve null; com chave devolve o provider", () => {
    expect(getLlmProvider({ LLM_PROVIDER: "anthropic", GEMINI_API_KEY: "k" })).toBeNull();
    expect(getLlmProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })?.name).toBe("anthropic");
  });
});
