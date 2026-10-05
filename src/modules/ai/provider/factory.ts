import type { Config } from "@/lib/config";
import { AnthropicProvider } from "./anthropic";
import { FakeLLMProvider } from "./fake";
import { GeminiProvider } from "./gemini";
import type { LLMProvider } from "./types";

type ProviderConfig = Pick<Config, "LLM_PROVIDER" | "GEMINI_API_KEY" | "ANTHROPIC_API_KEY">;

/** `null` quando falta a chave do provider escolhido: a IA conta como desligada. */
export function getLlmProvider(config: ProviderConfig): LLMProvider | null {
  switch (config.LLM_PROVIDER) {
    case "fake":
      return new FakeLLMProvider();
    case "gemini":
      return config.GEMINI_API_KEY ? new GeminiProvider({ apiKey: config.GEMINI_API_KEY }) : null;
    case "anthropic":
      return config.ANTHROPIC_API_KEY ? new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY }) : null;
  }
}
