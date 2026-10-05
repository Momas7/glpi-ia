import type { z } from "zod";
import { AiError } from "../types";

export const DEFAULT_TIMEOUT_MS = 30_000;

/** 429, 5xx e erros sem status (rede) valem nova tentativa; 4xx não. */
export function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
  const message = err instanceof Error ? err.message : "falha desconhecida no provider de IA";
  return new AiError(message, isRetryableStatus(status), { cause: err });
}

export async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiError(`tempo esgotado após ${ms} ms`, true));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A saída do LLM é não confiável: só passa se bater com o schema. */
export function parseOutput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AiError("resposta do modelo fora do formato esperado", false, { cause: parsed.error });
  return parsed.data;
}
