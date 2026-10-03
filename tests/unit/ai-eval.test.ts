import { describe, expect, it } from "vitest";
import { evaluateTriage, type EvalCase } from "@/modules/ai/eval";
import { FakeLLMProvider } from "@/modules/ai/provider/fake";
import { AiError } from "@/modules/ai/types";

const catalog = {
  categories: [
    { id: "c1", name: "Rede", defaultTeamId: "t1" },
    { id: "c2", name: "Acessos", defaultTeamId: "t2" },
  ],
  teams: [
    { id: "t1", name: "Infraestrutura" },
    { id: "t2", name: "Suporte N1" },
  ],
};

const cases: EvalCase[] = [
  { title: "Wi-Fi", description: "O Wi-Fi caiu", expected: { category: "Rede", priority: "MEDIUM", team: "Infraestrutura" } },
  { title: "Senha", description: "Minha senha expirou", expected: { category: "Rede", priority: "MEDIUM", team: "Suporte N1" } },
];

describe("evaluateTriage", () => {
  it("calcula o acerto por campo e lista as falhas", async () => {
    const r = await evaluateTriage(new FakeLLMProvider(), catalog, cases, "fake-triage");
    expect(r.total).toBe(2);
    expect(r.categoryAccuracy).toBe(0.5);
    expect(r.priorityAccuracy).toBe(1);
    expect(r.teamAccuracy).toBe(1);
    expect(r.costUsd).toBe(0);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].title).toBe("Senha");
  });

  it("falha do provider conta como erro nos três campos, sem derrubar a avaliação", async () => {
    const broken = new FakeLLMProvider(() => {
      throw new Error("sem rede");
    });
    const r = await evaluateTriage(broken, catalog, cases, "fake-triage");
    expect(r).toMatchObject({ total: 2, categoryAccuracy: 0, priorityAccuracy: 0, teamAccuracy: 0 });
    expect(r.failures).toHaveLength(2);
  });

  it("estima o custo pelo modelo", async () => {
    const r = await evaluateTriage(new FakeLLMProvider(), catalog, [cases[0]], "claude-haiku-4-5-20251001");
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("categoria esperada nula só acerta quando o modelo também não escolhe categoria", async () => {
    const none: EvalCase = { title: "Monitor", description: "Preciso de um monitor", expected: { category: null, priority: "MEDIUM", team: null } };
    const r = await evaluateTriage(new FakeLLMProvider(), catalog, [none], "fake-triage");
    expect(r.categoryAccuracy).toBe(1);
    expect(r.teamAccuracy).toBe(1);
  });

  it("tenta de novo em erro temporário, com espera crescente, e pausa entre os casos", async () => {
    let calls = 0;
    const flaky = new FakeLLMProvider(({ user }) => {
      if (++calls === 1) throw new AiError("429", true);
      return { categoryId: "c1", priority: "MEDIUM", teamId: "t1", confidence: 0.9, echo: user.length };
    });
    const waits: number[] = [];
    const r = await evaluateTriage(flaky, catalog, cases, "fake-triage", {
      delayMs: 50,
      retryBaseMs: 100,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(r.failures.map((f) => f.title)).toEqual(["Senha"]); // o primeiro caso acertou depois da nova tentativa
    expect(waits).toEqual([100, 50]); // nova tentativa (100) e uma pausa entre os dois casos (50)
  });

  it("erro não temporário não é repetido", async () => {
    let calls = 0;
    const bad = new FakeLLMProvider(() => {
      calls++;
      throw new AiError("chave inválida", false);
    });
    await evaluateTriage(bad, catalog, [cases[0]], "fake-triage", { sleep: async () => {} });
    expect(calls).toBe(1);
  });
});
