/** Erro de domínio que já sabe seu status HTTP; o wrapper das rotas o converte em resposta. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Sem permissão para esta ação.") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
  }
}
