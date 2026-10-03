import type { Config } from "@/lib/config";
import { FakeEmbeddingProvider } from "./fake";
import { GeminiEmbeddingProvider } from "./gemini";
import type { EmbeddingProvider } from "./types";

/** `null` quando falta a chave do provider escolhido: a busca por conhecimento conta como desligada. */
export function getEmbeddingProvider(config: Pick<Config, "EMBEDDING_PROVIDER" | "GEMINI_API_KEY">): EmbeddingProvider | null {
  if (config.EMBEDDING_PROVIDER === "fake") return new FakeEmbeddingProvider();
  return config.GEMINI_API_KEY ? new GeminiEmbeddingProvider({ apiKey: config.GEMINI_API_KEY }) : null;
}
