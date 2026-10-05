import { describe, expect, it } from "vitest";
import { evaluateRetrieval, type RagCase } from "@/modules/ai/eval";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";

const fake = new FakeEmbeddingProvider();
const embed = async (texts: string[], kind: "document" | "query") => (await fake.embed(texts, { kind, model: "fake-embedding" })).vectors;

const articles = [
  { title: "Wi-Fi sem conexão", body: "Se o Wi-Fi do andar não conecta, reinicie o ponto de acesso e confira o cabo de rede." },
  { title: "Impressora não imprime", body: "Quando a impressora trava a fila de impressão, reinicie o serviço de spool e limpe a fila." },
  { title: "Redefinir senha", body: "Para redefinir a senha esquecida da conta, use o link de redefinição enviado ao e-mail corporativo." },
];

describe("evaluateRetrieval", () => {
  it("acha o artigo certo no top-k para perguntas parecidas", async () => {
    const cases: RagCase[] = [
      { question: "O Wi-Fi do andar não conecta mais", expectedArticle: "Wi-Fi sem conexão" },
      { question: "A fila de impressão da impressora travou", expectedArticle: "Impressora não imprime" },
      { question: "Esqueci a senha da minha conta", expectedArticle: "Redefinir senha" },
    ];
    const r = await evaluateRetrieval(embed, articles, cases, { k: 1, minSimilarity: 0.05 });
    expect(r.total).toBe(3);
    expect(r.answerable).toBe(3);
    expect(r.recallAtK).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it("pergunta errada de propósito conta como falha e lista o que veio", async () => {
    const r = await evaluateRetrieval(embed, articles, [{ question: "A impressora travou a fila", expectedArticle: "Wi-Fi sem conexão" }], {
      k: 1,
      minSimilarity: 0.05,
    });
    expect(r.recallAtK).toBe(0);
    expect(r.failures[0]).toMatchObject({ question: "A impressora travou a fila", expected: "Wi-Fi sem conexão" });
    expect(r.failures[0].got).toContain("Impressora não imprime");
  });

  it("pergunta sem artigo correspondente acerta quando nada passa do limiar", async () => {
    const cases: RagCase[] = [{ question: "Reservar a sala de reunião para o orçamento anual", expectedArticle: "" }];
    const r = await evaluateRetrieval(embed, articles, cases, { k: 3, minSimilarity: 0.6 });
    expect(r.unanswerable).toBe(1);
    expect(r.rejectedCorrectly).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it("pergunta sem artigo correspondente falha se uma fonte passar do limiar", async () => {
    const cases: RagCase[] = [{ question: "O Wi-Fi do andar não conecta", expectedArticle: "" }];
    const r = await evaluateRetrieval(embed, articles, cases, { k: 3, minSimilarity: 0.1 });
    expect(r.rejectedCorrectly).toBe(0);
    expect(r.failures).toHaveLength(1);
  });

  it("artigo longo é dividido em trechos e o melhor trecho conta", async () => {
    const long = { title: "Manual de rede", body: Array.from({ length: 60 }, (_, i) => `Passo ${i}: verifique o equipamento ${i}.`).join(" ") + " Para o Wi-Fi do andar, reinicie o ponto de acesso." };
    const r = await evaluateRetrieval(embed, [long, ...articles.slice(1)], [{ question: "reinicie o ponto de acesso do Wi-Fi", expectedArticle: "Manual de rede" }], {
      k: 1,
      minSimilarity: 0.05,
    });
    expect(r.recallAtK).toBe(1);
  });
});
