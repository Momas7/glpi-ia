import type { z } from "zod";

export interface LLMRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  model: string;
  timeoutMs?: number;
}

export interface LLMResult<T> {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
}

export type ProviderName = "fake" | "gemini" | "anthropic";

export interface LLMProvider {
  readonly name: ProviderName;
  /** Devolve JSON já validado pelo schema; falhas viram `AiError`. */
  generate<T>(req: LLMRequest<T>): Promise<LLMResult<T>>;
}
