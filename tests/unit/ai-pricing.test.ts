import { describe, expect, it } from "vitest";
import { defaultTriageModel, estimateCostUsd } from "@/modules/ai/pricing";

describe("estimateCostUsd", () => {
  it("calcula pelo preço por milhão de tokens do modelo", () => {
    expect(estimateCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBe(6);
    expect(estimateCostUsd("gemini-2.5-flash", 2_000_000, 0)).toBeCloseTo(0.6);
  });
  it("o modelo de triagem padrão do Gemini tem preço próprio (não cai no mais caro)", () => {
    expect(estimateCostUsd(defaultTriageModel("gemini"), 1_000_000, 1_000_000)).toBeCloseTo(2.8);
  });
  it("modelo fake custa zero", () => {
    expect(estimateCostUsd("fake-triage", 1000, 1000)).toBe(0);
  });
  it("modelo sem preço na tabela usa o preço mais alto conhecido, para o teto diário nunca ficar cego", () => {
    expect(estimateCostUsd("modelo-novo", 1_000_000, 1_000_000)).toBe(90);
    expect(estimateCostUsd("gemini-2.0-flash", 1_000_000, 0)).toBe(15);
  });
  it("escolhe o modelo pequeno por provider", () => {
    expect(defaultTriageModel("gemini")).toBe("gemini-3.8-flash");
    expect(defaultTriageModel("anthropic")).toMatch(/^claude-haiku/);
    expect(defaultTriageModel("fake")).toBe("fake-triage");
  });
});
