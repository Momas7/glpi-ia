import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Aceita o id enviado pelo cliente só se for curto e inofensivo (vai para o log e volta no cabeçalho); senão gera um. */
export function resolveRequestId(header: string | null): string {
  return header && SAFE_ID.test(header) ? header : randomUUID();
}

interface RequestLog {
  info: (entry: Record<string, unknown>, msg: string) => void;
  error: (entry: Record<string, unknown>, msg: string) => void;
}

/**
 * Envolve uma rota: gera/propaga `X-Request-Id`, mede o tempo e registra método, rota (sem query string), status e
 * duração. Nunca registra corpo, query nem cabeçalhos. Exceção vira 500 genérico (a mensagem fica só no log interno).
 * Chamadas de saúde não são registradas (o healthcheck bate a cada poucos segundos).
 */
export async function instrument(req: Request, run: () => Promise<Response>, log: RequestLog = logger as unknown as RequestLog): Promise<Response> {
  const requestId = resolveRequestId(req.headers.get("x-request-id"));
  const path = new URL(req.url).pathname;
  const started = Date.now();
  let response: Response;
  try {
    response = await run();
  } catch (err) {
    log.error({ requestId, method: req.method, path, err: err instanceof Error ? { type: err.name, message: err.message } : "erro desconhecido" }, "exceção não tratada na rota");
    response = Response.json({ error: "Erro interno." }, { status: 500 });
  }
  try {
    response.headers.set("X-Request-Id", requestId);
  } catch {
    // resposta com cabeçalhos imutáveis (ex.: vinda de fetch): copia
    response = new Response(response.body, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
    response.headers.set("X-Request-Id", requestId);
  }
  if (!path.startsWith("/api/health")) {
    const entry = { requestId, method: req.method, path, status: response.status, ms: Date.now() - started };
    if (response.status >= 500) log.error(entry, "requisição com erro");
    else log.info(entry, "requisição");
  }
  return response;
}
