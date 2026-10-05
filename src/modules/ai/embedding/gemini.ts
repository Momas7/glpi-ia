import { GoogleGenAI } from "@google/genai";
import { AiError } from "../types";
import { DEFAULT_TIMEOUT_MS, toAiError, withTimeout } from "../provider/shared";
import { EMBEDDING_DIMENSIONS, l2Normalize, type EmbedOptions, type EmbeddingProvider } from "./types";

/** Parte do cliente do SDK que usamos (permite simular nos testes). */
export interface GeminiEmbedClient {
  models: {
    embedContent(params: {
      model: string;
      contents: string[];
      config: Record<string, unknown>;
    }): Promise<{ embeddings?: { values?: number[] }[] }>;
  };
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini" as const;
  private readonly client: GeminiEmbedClient;

  constructor(opts: { apiKey: string; client?: GeminiEmbedClient }) {
    this.client = opts.client ?? (new GoogleGenAI({ apiKey: opts.apiKey }) as unknown as GeminiEmbedClient);
  }

  async embed(texts: string[], opts: EmbedOptions) {
    try {
      const res = await withTimeout(
        (signal) =>
          this.client.models.embedContent({
            model: opts.model,
            contents: texts,
            config: {
              taskType: opts.kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
              outputDimensionality: EMBEDDING_DIMENSIONS,
              abortSignal: signal,
            },
          }),
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      const embeddings = res.embeddings ?? [];
      if (embeddings.length !== texts.length) throw new AiError("quantidade de vetores diferente da de textos", false);
      const vectors = embeddings.map((e) => {
        const values = e.values ?? [];
        if (values.length !== EMBEDDING_DIMENSIONS) throw new AiError(`vetor com ${values.length} dimensões (esperado ${EMBEDDING_DIMENSIONS})`, false);
        return l2Normalize(values);
      });
      return { vectors, usage: { inputTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0) } };
    } catch (err) {
      throw toAiError(err);
    }
  }
}
