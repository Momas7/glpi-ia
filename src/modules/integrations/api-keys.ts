import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit";
// Imports diretos (não pelo index de auth) evitam ciclo: auth usa emitEvent deste módulo.
import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";

export const API_SCOPES = ["tickets:create", "comments:create"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const INVALID_KEY = "Chave de API inválida.";
const KEY_PATTERN = /^Bearer (gk_([0-9a-f]{8})_[A-Za-z0-9_-]{20,})$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function assertAdmin(actor: SessionUser) {
  if (!can(actor, "admin:manage")) throw new ForbiddenError();
}

/** O segredo é devolvido só aqui, uma vez; o banco guarda apenas o SHA-256 da chave inteira. */
export async function createApiKey(
  actor: SessionUser,
  input: { name: string; scopes: ApiScope[] },
): Promise<{ id: string; key: string; prefix: string }> {
  assertAdmin(actor);
  const prefix = randomBytes(4).toString("hex");
  const key = `gk_${prefix}_${randomBytes(24).toString("base64url")}`;
  return getDb().$transaction(async (tx) => {
    const row = await tx.apiKey.create({
      data: { name: input.name.trim(), prefix, keyHash: sha256(key), scopes: input.scopes, createdById: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "apikey.create",
      targetType: "apikey",
      targetId: row.id,
      data: { name: row.name, prefix, scopes: input.scopes },
    });
    return { id: row.id, key, prefix };
  });
}

export async function listApiKeys(actor: SessionUser) {
  assertAdmin(actor);
  return getDb().apiKey.findMany({
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeApiKey(actor: SessionUser, id: string): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const row = await tx.apiKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Chave não encontrada.");
    if (row.revokedAt) return;
    await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { actorId: actor.id, action: "apikey.revoke", targetType: "apikey", targetId: id, data: { name: row.name } });
  });
}

/** Valida `Authorization: Bearer gk_...`. Qualquer problema com a chave dá o mesmo 401; escopo ausente dá 403. */
export async function authenticateApiKey(authorization: string | null, scope: ApiScope): Promise<{ id: string; name: string }> {
  const match = authorization?.match(KEY_PATTERN);
  if (!match) throw new AppError(401, INVALID_KEY);
  const [, key, prefix] = match;
  const row = await getDb().apiKey.findUnique({ where: { prefix } });
  const expected = Buffer.from(row?.keyHash ?? sha256(`nenhuma-${prefix}`));
  const received = Buffer.from(sha256(key));
  if (!row || row.revokedAt || !timingSafeEqual(expected, received)) throw new AppError(401, INVALID_KEY);
  if (!row.scopes.includes(scope)) throw new AppError(403, "A chave não tem permissão para esta ação.");
  await getDb().apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { id: row.id, name: row.name };
}
