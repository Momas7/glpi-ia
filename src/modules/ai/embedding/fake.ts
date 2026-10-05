import { EMBEDDING_DIMENSIONS, l2Normalize, type EmbedOptions, type EmbeddingProvider } from "./types";

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function wordIndex(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  return (h >>> 0) % EMBEDDING_DIMENSIONS;
}

/** Saco de palavras determinístico: textos com palavras em comum ficam próximos. Só para testes e demonstração. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake" as const;

  async embed(texts: string[], _opts: EmbedOptions) {
    const vectors = texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of normalize(text).split(/[^a-z0-9]+/).filter((w) => w.length > 1)) v[wordIndex(word)] += 1;
      return v.some((x) => x !== 0) ? l2Normalize(v) : (v[0] = 1, v);
    });
    return { vectors, usage: { inputTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0) } };
  }
}
