import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { escapeLike } from "@/lib/like";
import { recordAudit } from "@/modules/audit";
import { can, type Role, type SessionUser } from "@/modules/auth";

const MAX_PAGE_SIZE = 100;
const LAST_ADMIN_MESSAGE = "É preciso manter ao menos um administrador ativo.";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  teams: { id: string; name: string }[];
}

const userInclude = { teams: { include: { team: { select: { id: true, name: true } } } } } satisfies Prisma.UserInclude;
type UserWithTeams = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const toRow = (u: UserWithTeams): AdminUserRow => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
  teams: u.teams.map((m) => m.team),
});

function assertAdmin(actor: SessionUser) {
  if (!can(actor, "admin:manage")) throw new ForbiddenError();
}

/**
 * Trava os ADMIN ativos (sempre na mesma ordem, para não haver deadlock) antes de qualquer mudança que
 * possa tirar um ADMIN de ação. Duas mudanças simultâneas se enfileiram e a segunda enxerga o resultado da primeira.
 */
async function lockActiveAdmins(tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE role = 'ADMIN' AND active = true ORDER BY id FOR UPDATE`;
  return rows.map((r) => r.id);
}

async function loadTarget(tx: Prisma.TransactionClient, userId: string) {
  const target = await tx.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError("Usuário não encontrado.");
  return target;
}

export async function listUsers(
  actor: SessionUser,
  query: { page: number; pageSize: number; q?: string },
): Promise<{ items: AdminUserRow[]; total: number }> {
  assertAdmin(actor);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize)));
  const page = Math.max(1, Math.floor(query.page));
  const q = query.q?.trim();
  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { name: { contains: escapeLike(q), mode: "insensitive" } },
          { email: { contains: escapeLike(q), mode: "insensitive" } },
        ],
      }
    : {};
  const db = getDb();
  const [items, total] = await Promise.all([
    db.user.findMany({ where, include: userInclude, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.user.count({ where }),
  ]);
  return { items: items.map(toRow), total };
}

export async function changeRole(actor: SessionUser, userId: string, role: Role): Promise<AdminUserRow> {
  assertAdmin(actor);
  if (userId === actor.id) throw new AppError(400, "Você não pode alterar o próprio papel.");
  return getDb().$transaction(async (tx) => {
    const admins = await lockActiveAdmins(tx);
    const target = await loadTarget(tx, userId);
    if (target.role === role) return toRow(await tx.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude }));
    const removesAdmin = target.role === "ADMIN" && target.active && role !== "ADMIN";
    if (removesAdmin && admins.filter((id) => id !== userId).length === 0) throw new AppError(400, LAST_ADMIN_MESSAGE);

    const updated = await tx.user.update({ where: { id: userId }, data: { role }, include: userInclude });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "user.role_change",
      targetType: "user",
      targetId: userId,
      data: { from: target.role, to: role },
    });
    return toRow(updated);
  });
}

/** Desativar revoga todas as sessões do usuário na mesma transação. */
export async function setActive(actor: SessionUser, userId: string, active: boolean): Promise<AdminUserRow> {
  assertAdmin(actor);
  if (userId === actor.id) throw new AppError(400, "Você não pode desativar ou reativar a própria conta.");
  return getDb().$transaction(async (tx) => {
    const admins = await lockActiveAdmins(tx);
    const target = await loadTarget(tx, userId);
    if (target.active === active) return toRow(await tx.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude }));
    const removesAdmin = target.role === "ADMIN" && !active;
    if (removesAdmin && admins.filter((id) => id !== userId).length === 0) throw new AppError(400, LAST_ADMIN_MESSAGE);

    const updated = await tx.user.update({ where: { id: userId }, data: { active }, include: userInclude });
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: active ? "user.activate" : "user.deactivate",
      targetType: "user",
      targetId: userId,
    });
    return toRow(updated);
  });
}

export async function listPendingInvites(actor: SessionUser) {
  assertAdmin(actor);
  return getDb().invite.findMany({
    where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeInvite(actor: SessionUser, inviteId: string): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { id: inviteId } });
    if (!invite) throw new NotFoundError("Convite não encontrado.");
    if (invite.usedAt) throw new AppError(409, "Este convite já foi utilizado.");
    if (invite.revokedAt) return;
    await tx.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "invite.revoke",
      targetType: "invite",
      targetId: inviteId,
      data: { email: invite.email },
    });
  });
}
