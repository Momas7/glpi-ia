import { describe, expect, it } from "vitest";
import { defaultTriageModel, estimateCostUsd } from "@/modules/ai/pricing";

describe("estimateCostUsd", () => {
  it("calcula pelo preço por milhão de tokens do modelo", () => {
    expect(estimateCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBe(6);
    expect(estimateCostUsd("gemini-2.5-flash", 2_000_000, 0)).toBeCloseTo(0.6);
  });
  it("modelo desconhecido ou fake custa zero", () => {
    expect(estimateCostUsd("modelo-novo", 1000, 1000)).toBe(0);
    expect(estimateCostUsd("fake-triage", 1000, 1000)).toBe(0);
  });
  it("escolhe o modelo pequeno por provider", () => {
    expect(defaultTriageModel("gemini")).toBe("gemini-2.5-flash");
    expect(defaultTriageModel("anthropic")).toMatch(/^claude-haiku/);
    expect(defaultTriageModel("fake")).toBe("fake-triage");
  });
});
