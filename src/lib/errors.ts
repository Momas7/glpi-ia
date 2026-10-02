/** Erro de domínio que já sabe seu status HTTP; o wrapper das rotas o converte em resposta. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
