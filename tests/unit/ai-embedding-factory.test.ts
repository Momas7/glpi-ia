import { describe, expect, it } from "vitest";
import { getEmbeddingProvider } from "@/modules/ai/embedding/factory";

describe("getEmbeddingProvider", () => {
  it("fake não precisa de chave", () => {
    expect(getEmbeddingProvider({ EMBEDDING_PROVIDER: "fake" })?.name).toBe("fake");
  });
  it("gemini sem chave devolve null; com chave devolve o provider", () => {
    expect(getEmbeddingProvider({ EMBEDDING_PROVIDER: "gemini" })).toBeNull();
    expect(getEmbeddingProvider({ EMBEDDING_PROVIDER: "gemini", GEMINI_API_KEY: "k" })?.name).toBe("gemini");
  });
});
