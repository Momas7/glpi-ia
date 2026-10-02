import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit";
import { can, type SessionUser } from "@/modules/auth";

const STAFF_ROLES = ["AGENT", "TEAM_LEAD", "ADMIN"] as const;

function assertAdmin(actor: SessionUser) {
  if (!can(actor, "admin:manage")) throw new ForbiddenError();
}

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "P2002";

async function requireTeam(tx: Prisma.TransactionClient, teamId: string) {
  const team = await tx.team.findUnique({ where: { id: teamId } });
  if (!team) throw new NotFoundError("Equipe não encontrada.");
  return team;
}

export async function listTeams(actor: SessionUser) {
  assertAdmin(actor);
  const teams = await getDb().team.findMany({
    orderBy: { name: "asc" },
    include: { members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } } },
  });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    members: t.members.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  }));
}

export async function createTeam(actor: SessionUser, name: string) {
  assertAdmin(actor);
  try {
    return await getDb().$transaction(async (tx) => {
      const team = await tx.team.create({ data: { name: name.trim() } });
      await recordAudit(tx, { actorId: actor.id, action: "team.create", targetType: "team", targetId: team.id, data: { name: team.name } });
      return team;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "Já existe uma equipe com esse nome.");
    throw err;
  }
}

export async function renameTeam(actor: SessionUser, teamId: string, name: string) {
  assertAdmin(actor);
  try {
    return await getDb().$transaction(async (tx) => {
      const before = await requireTeam(tx, teamId);
      const team = await tx.team.update({ where: { id: teamId }, data: { name: name.trim() } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "team.rename",
        targetType: "team",
        targetId: teamId,
        data: { from: before.name, to: team.name },
      });
      return team;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "Já existe uma equipe com esse nome.");
    throw err;
  }
}

/** Só técnicos ativos (AGENT, TEAM_LEAD, ADMIN) entram em equipes. Adicionar de novo não duplica. */
export async function addMember(actor: SessionUser, teamId: string, userId: string): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    await requireTeam(tx, teamId);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !(STAFF_ROLES as readonly string[]).includes(user.role)) {
      throw new AppError(400, "Só técnicos ativos podem fazer parte de uma equipe.");
    }
    const existing = await tx.teamMember.findUnique({ where: { userId_teamId: { userId, teamId } } });
    if (existing) return;
    await tx.teamMember.create({ data: { userId, teamId } });
    await recordAudit(tx, { actorId: actor.id, action: "team.member_add", targetType: "team", targetId: teamId, data: { userId } });
  });
}

export async function removeMember(actor: SessionUser, teamId: string, userId: string): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    await requireTeam(tx, teamId);
    const removed = await tx.teamMember.deleteMany({ where: { userId, teamId } });
    if (removed.count === 0) return;
    await recordAudit(tx, { actorId: actor.id, action: "team.member_remove", targetType: "team", targetId: teamId, data: { userId } });
  });
}

export async function listCategories(actor: SessionUser) {
  assertAdmin(actor);
  const categories = await getDb().category.findMany({
    orderBy: { name: "asc" },
    include: { defaultTeam: { select: { id: true, name: true } } },
  });
  return categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, defaultTeam: c.defaultTeam }));
}

async function validateCategoryRefs(tx: Prisma.TransactionClient, refs: { parentId?: string | null; defaultTeamId?: string | null }) {
  if (refs.defaultTeamId && !(await tx.team.findUnique({ where: { id: refs.defaultTeamId } }))) {
    throw new AppError(400, "Equipe padrão não encontrada.");
  }
  if (refs.parentId && !(await tx.category.findUnique({ where: { id: refs.parentId } }))) {
    throw new AppError(400, "Categoria-pai não encontrada.");
  }
}

export async function createCategory(
  actor: SessionUser,
  input: { name: string; parentId?: string; defaultTeamId?: string },
) {
  assertAdmin(actor);
  try {
    return await getDb().$transaction(async (tx) => {
      await validateCategoryRefs(tx, input);
      const category = await tx.category.create({
        data: { name: input.name.trim(), parentId: input.parentId, defaultTeamId: input.defaultTeamId },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "category.create",
        targetType: "category",
        targetId: category.id,
        data: { name: category.name, parentId: category.parentId, defaultTeamId: category.defaultTeamId },
      });
      return category;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "Já existe uma categoria com esse nome neste nível.");
    throw err;
  }
}

export async function updateCategory(
  actor: SessionUser,
  categoryId: string,
  input: { name?: string; defaultTeamId?: string | null },
) {
  assertAdmin(actor);
  try {
    return await getDb().$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id: categoryId } });
      if (!before) throw new NotFoundError("Categoria não encontrada.");
      await validateCategoryRefs(tx, { defaultTeamId: input.defaultTeamId });
      const category = await tx.category.update({
        where: { id: categoryId },
        data: { name: input.name?.trim(), defaultTeamId: input.defaultTeamId },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "category.update",
        targetType: "category",
        targetId: categoryId,
        data: {
          from: { name: before.name, defaultTeamId: before.defaultTeamId },
          to: { name: category.name, defaultTeamId: category.defaultTeamId },
        },
      });
      return category;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "Já existe uma categoria com esse nome neste nível.");
    throw err;
  }
}
