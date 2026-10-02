import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getRequestUser, type SessionUser } from "@/modules/auth";

z.config(z.locales.ptBR());

/** IP do cliente. Atrás do proxy (Caddy) o primeiro item de X-Forwarded-For é o cliente real. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Proteção CSRF: em métodos que alteram estado, um Origin presente precisa ser o do próprio app. */
function originAllowed(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // clientes que não são navegadores não enviam Origin e não sofrem CSRF
  const allowed = new Set([new URL(req.url).origin]);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  return allowed.has(origin);
}

export function jsonError(status: number, error: string, extra: object = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof z.ZodError) {
    return jsonError(400, "Dados inválidos.", {
      issues: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof AppError) return jsonError(err.status, err.message);
  logger.error({ err }, "erro não tratado na rota");
  return jsonError(500, "Erro interno.");
}

export interface AuthedContext<P> {
  req: Request;
  user: SessionUser;
  params: P;
}

/** Autentica pela sessão, valida Origin e converte erros de domínio e de validação em respostas HTTP. */
export function withAuth<P = Record<string, never>>(handler: (ctx: AuthedContext<P>) => Promise<Response>) {
  return async (req: Request, routeCtx?: { params: Promise<P> }): Promise<Response> => {
    try {
      const user = await getRequestUser(req);
      if (!user) return jsonError(401, "Não autenticado.");
      if (!originAllowed(req)) return jsonError(403, "Origem não permitida.");
      const params = (routeCtx ? await routeCtx.params : {}) as P;
      return await handler({ req, user, params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => {
    throw new AppError(400, "Corpo da requisição inválido.");
  });
}
