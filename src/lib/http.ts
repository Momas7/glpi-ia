import { NextResponse } from "next/server";
import { z } from "zod";
import { readBodyLimited } from "@/lib/body";
import { AppError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { can, checkRateLimit, getRequestUser, type SessionUser } from "@/modules/auth";
import { authenticateApiKey, type ApiScope } from "@/modules/integrations";

z.config(z.locales.ptBR());

export { clientIp } from "@/lib/client-ip";

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

const MAX_JSON_BYTES = 64 * 1024;

/** Lê JSON com teto de 64 KB (413 acima disso); JSON malformado vira 400. */
export async function readJson(req: Request): Promise<unknown> {
  const bytes = await readBodyLimited(req, MAX_JSON_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(400, "Corpo da requisição inválido.");
  }
}

/** Como `readJson`, mas corpo vazio devolve `undefined` (rotas em que o corpo é opcional). */
export async function readOptionalJson(req: Request): Promise<unknown> {
  const bytes = await readBodyLimited(req, MAX_JSON_BYTES);
  if (bytes.length === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(400, "Corpo da requisição inválido.");
  }
}

/** Para rotas públicas (sem sessão): converte erros de domínio e de validação em respostas HTTP. */
export function withErrors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Rotas /api/admin: além de autenticar, exige admin:manage antes de ler o corpo (403 vem antes de 400). */
export function withAdmin<P = Record<string, never>>(handler: (ctx: AuthedContext<P>) => Promise<Response>) {
  return withAuth<P>(async (ctx) => {
    if (!can(ctx.user, "admin:manage")) throw new ForbiddenError();
    return handler(ctx);
  });
}

export interface ApiKeyContext<P> {
  req: Request;
  apiKey: { id: string; name: string };
  params: P;
}

/** Rotas /api/v1 (integrações): chave de API com escopo, 60 requisições/min por chave, erros em JSON. */
export function withApiKey<P = Record<string, never>>(scope: ApiScope, handler: (ctx: ApiKeyContext<P>) => Promise<Response>) {
  return async (req: Request, routeCtx?: { params: Promise<P> }): Promise<Response> => {
    try {
      const apiKey = await authenticateApiKey(req.headers.get("authorization"), scope);
      if (!checkRateLimit(`apikey:${apiKey.id}`, 60, 60)) return jsonError(429, "Limite de requisições excedido.");
      const params = (routeCtx ? await routeCtx.params : {}) as P;
      return await handler({ req, apiKey, params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
