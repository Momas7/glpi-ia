/** Falha numa chamada de IA. `retryable` diz se vale tentar de novo (429, 5xx, rede, tempo esgotado). */
export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AiError";
  }
}
