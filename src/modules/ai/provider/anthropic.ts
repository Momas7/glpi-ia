import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AiError } from "../types";
import { DEFAULT_TIMEOUT_MS, parseOutput, toAiError, withTimeout } from "./shared";
import type { LLMProvider, LLMRequest, LLMResult } from "./types";

const OUTPUT_TOOL = "registrar_resultado";

/** Parte do cliente do SDK que usamos (permite simular nos testes). */
export interface AnthropicClient {
  messages: {
    create(
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): Promise<{
      content: { type: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  private readonly client: AnthropicClient;

  constructor(opts: { apiKey: string; client?: AnthropicClient }) {
    this.client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }) as unknown as AnthropicClient);
  }

  async generate<T>(req: LLMRequest<T>): Promise<LLMResult<T>> {
    try {
      const res = await withTimeout(
        (signal) =>
          this.client.messages.create(
            {
              model: req.model,
              max_tokens: 1024,
              system: req.system,
              messages: [{ role: "user", content: req.user }],
              tools: [
                {
                  name: OUTPUT_TOOL,
                  description: "Registra o resultado estruturado da tarefa.",
                  input_schema: z.toJSONSchema(req.schema),
                },
              ],
              tool_choice: { type: "tool", name: OUTPUT_TOOL },
            },
            { signal },
          ),
        req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      const block = res.content.find((b) => b.type === "tool_use");
      if (!block) throw new AiError("o modelo não devolveu o resultado estruturado", false);
      return {
        data: parseOutput(req.schema, block.input),
        usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
      };
    } catch (err) {
      throw toAiError(err);
    }
  }
}
