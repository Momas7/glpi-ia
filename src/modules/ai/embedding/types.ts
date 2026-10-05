export const EMBEDDING_DIMENSIONS = 768;

export interface EmbedOptions {
  /** `document` para o que vai para o índice; `query` para a pergunta (os modelos tratam diferente). */
  kind: "document" | "query";
  model: string;
  timeoutMs?: number;
}

export interface EmbeddingProvider {
  readonly name: "fake" | "gemini";
  /** Um vetor de 768 dimensões por texto, na mesma ordem. Falhas viram `AiError`. */
  embed(texts: string[], opts: EmbedOptions): Promise<{ vectors: number[][]; usage: { inputTokens: number } }>;
}

export function l2Normalize(v: number[]): number[] {
  const norm = Math.hypot(...v);
  return norm === 0 ? v : v.map((x) => x / norm);
}
