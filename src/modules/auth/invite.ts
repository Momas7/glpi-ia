import { getDb } from "@/lib/db";
import { hashPassword, validatePasswordPolicy } from "./password";
import { hashToken, type Role } from "./session";
import { appUrl, newToken } from "./tokens";

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export async function createInvite(input: {
  email: string;
  role: Role;
  createdById: string;
}): Promise<{ token: string; inviteUrl: string }> {
  const db = getDb();
  const creator = await db.user.findUnique({ where: { id: input.createdById } });
  if (!creator || creator.role !== "ADMIN" || !creator.active) {
    throw new Error("Somente administradores podem criar convites.");
  }
  const { token, tokenHash } = newToken();
  await db.invite.create({
    data: {
      email: input.email.trim().toLowerCase(),
      role: input.role,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdById: input.createdById,
    },
  });
  return { token, inviteUrl: `${appUrl()}/accept-invite?token=${token}` };
}

/** Falhas (token inválido, usado, expirado, senha fraca, e-mail já cadastrado) são indistinguíveis. */
export async function acceptInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ ok: boolean }> {
  if (!validatePasswordPolicy(input.password).ok) return { ok: false };
  const db = getDb();
  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date()) return { ok: false };
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return { ok: false };
      await tx.user.create({
        data: { name: input.name.trim(), email: invite.email, role: invite.role, passwordHash },
      });
      return { ok: true };
    });
  } catch {
    // e-mail já cadastrado (violação de unicidade): a transação inteira é desfeita
    return { ok: false };
  }
}
