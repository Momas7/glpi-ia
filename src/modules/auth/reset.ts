import { getDb } from "@/lib/db";
import { sendMail } from "@/modules/notifications";
import { hashPassword, validatePasswordPolicy } from "./password";
import { hashToken, revokeSessions } from "./session";
import { appUrl, newToken } from "./tokens";

const RESET_TTL_MS = 60 * 60 * 1000;

/** Sempre resolve igual, exista ou não a conta (não revela quais e-mails estão cadastrados). */
export async function requestReset(email: string): Promise<void> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return;
  const { token, tokenHash } = newToken();
  await db.passwordReset.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  await sendMail({
    to: user.email,
    subject: "Redefinição de senha",
    text: `Para redefinir sua senha acesse: ${appUrl()}/reset?token=${token}\nO link vale por 1 hora e só pode ser usado uma vez.`,
  });
}

export async function resetPassword(input: { token: string; password: string }): Promise<{ ok: boolean }> {
  if (!validatePasswordPolicy(input.password).ok) return { ok: false };
  const db = getDb();
  const row = await db.passwordReset.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return { ok: false };
  const passwordHash = await hashPassword(input.password);

  const claimed = await db.passwordReset.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false };

  await db.user.update({
    where: { id: row.userId },
    data: { passwordHash, failedLogins: 0, lockedUntil: null },
  });
  await revokeSessions(row.userId);
  return { ok: true };
}
