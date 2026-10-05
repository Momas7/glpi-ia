import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AiError } from "../types";
import { DEFAULT_TIMEOUT_MS, parseOutput, toAiError, withTimeout } from "./shared";
import type { LLMProvider, LLMRequest, LLMResult } from "./types";

/** Parte do cliente do SDK que usamos (permite simular nos testes). */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{ text?: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }>;
  };
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  private readonly client: GeminiClient;

  constructor(opts: { apiKey: string; client?: GeminiClient }) {
    this.client = opts.client ?? (new GoogleGenAI({ apiKey: opts.apiKey }) as unknown as GeminiClient);
  }

  async generate<T>(req: LLMRequest<T>): Promise<LLMResult<T>> {
    try {
      const res = await withTimeout(
        (signal) =>
          this.client.models.generateContent({
            model: req.model,
            contents: req.user,
            config: {
              systemInstruction: req.system,
              responseMimeType: "application/json",
              responseJsonSchema: z.toJSONSchema(req.schema),
              abortSignal: signal,
            },
          }),
        req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      let json: unknown;
      try {
        json = JSON.parse(res.text ?? "");
      } catch (err) {
        throw new AiError("resposta do modelo não é JSON", false, { cause: err });
      }
      return {
        data: parseOutput(req.schema, json),
        usage: {
          inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (err) {
      throw toAiError(err);
    }
  }
}
