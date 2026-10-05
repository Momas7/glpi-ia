import { describe, expect, it } from "vitest";
import { evaluateDuplicates, type DupPair } from "@/modules/ai/eval";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";

const fake = new FakeEmbeddingProvider();
const embed = async (texts: string[], kind: "document" | "query") => (await fake.embed(texts, { kind, model: "fake-embedding" })).vectors;

const pairs: DupPair[] = [
  { a: "Sem internet no prédio — ninguém consegue conectar na rede", b: "Sem internet no prédio todo — ninguém conecta na rede", duplicate: true },
  { a: "Impressora do financeiro travou a fila de impressão", b: "A fila de impressão da impressora do financeiro travou", duplicate: true },
  { a: "Orçamento anual do financeiro e previsão de compras", b: "Sem internet no prédio — ninguém consegue conectar na rede", duplicate: false },
  { a: "Reservar sala de treinamento na quarta", b: "Impressora do financeiro travou a fila de impressão", duplicate: false },
];

describe("evaluateDuplicates", () => {
  it("acerta os duplicados óbvios sem falso alarme e devolve precisão e recall", async () => {
    const r = await evaluateDuplicates(embed, pairs, { threshold: 0.6 });
    expect(r.total).toBe(4);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.falsePositives).toEqual([]);
    expect(r.missed).toEqual([]);
  });

  it("limiar alto demais perde duplicados e lista os perdidos", async () => {
    const r = await evaluateDuplicates(embed, pairs, { threshold: 0.99 });
    expect(r.recall).toBe(0);
    expect(r.missed).toHaveLength(2);
    expect(r.precision).toBe(1); // nada previsto: não há falso alarme
  });

  it("limiar baixo demais gera falsos alarmes e lista os pares", async () => {
    const r = await evaluateDuplicates(embed, pairs, { threshold: 0 });
    expect(r.recall).toBe(1);
    expect(r.precision).toBeLessThan(1);
    expect(r.falsePositives.length).toBeGreaterThan(0);
  });

  it("sugere um limiar entre 0,50 e 0,95", async () => {
    const r = await evaluateDuplicates(embed, pairs);
    expect(r.suggestedThreshold).toBeGreaterThanOrEqual(0.5);
    expect(r.suggestedThreshold).toBeLessThanOrEqual(0.95);
  });
});
