import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/modules/ai/embedding/types";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";

const embed = async (...texts: string[]) =>
  (await new FakeEmbeddingProvider().embed(texts, { kind: "document", model: "fake-embedding" })).vectors;

const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

describe("FakeEmbeddingProvider", () => {
  it("devolve vetores de 768 dimensões com norma 1, na mesma ordem dos textos", async () => {
    const [a, b] = await embed("rede caiu", "impressora travou");
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(b).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...a)).toBeCloseTo(1);
    expect(a).not.toEqual(b);
  });

  it("é determinístico e textos iguais têm cosseno 1", async () => {
    const [a] = await embed("a impressora do financeiro");
    const [b] = await embed("a impressora do financeiro");
    expect(a).toEqual(b);
    expect(cosine(a, b)).toBeCloseTo(1);
  });

  it("textos com palavras em comum ficam mais próximos que textos sem relação", async () => {
    const [fila, imprime, reuniao] = await embed(
      "impressora travada na fila de impressão",
      "a impressora não imprime nada",
      "reunião de orçamento anual do financeiro",
    );
    expect(cosine(fila, imprime)).toBeGreaterThan(cosine(fila, reuniao));
  });

  it("ignora acentos e maiúsculas", async () => {
    const [a] = await embed("Impressão TRAVADA");
    const [b] = await embed("impressao travada");
    expect(cosine(a, b)).toBeCloseTo(1);
  });

  it("estima os tokens pelo tamanho do texto", async () => {
    const res = await new FakeEmbeddingProvider().embed(["x".repeat(40)], { kind: "query", model: "m" });
    expect(res.usage.inputTokens).toBe(10);
  });
});
