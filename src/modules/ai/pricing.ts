import type { ProviderName } from "./provider/types";

/** USD por milhão de tokens (entrada, saída). É estimativa para o teto de gasto, não fatura. */
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: "claude-haiku", input: 1, output: 5 },
  { prefix: "claude-sonnet", input: 3, output: 15 },
  { prefix: "claude-opus", input: 15, output: 75 },
  { prefix: "gemini-2.5-flash", input: 0.3, output: 2.5 },
  { prefix: "gemini-2.5-pro", input: 1.25, output: 10 },
];

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES.find((p) => model.startsWith(p.prefix));
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function defaultTriageModel(provider: ProviderName): string {
  return { fake: "fake-triage", gemini: "gemini-2.5-flash", anthropic: "claude-haiku-4-5-20251001" }[provider];
}
