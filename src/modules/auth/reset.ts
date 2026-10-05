import { getDb } from "@/lib/db";
import { emitEvent } from "@/modules/integrations";
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
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.$transaction(async (tx) => {
    await tx.passwordReset.create({ data: { userId: user.id, tokenHash, expiresAt } });
    // O n8n entrega o link (e-mail, Teams...). O link leva o token: o n8n não deve registrá-lo em log.
    await emitEvent(tx, "auth.password_reset_requested", {
      email: user.email,
      name: user.name,
      url: `${appUrl()}/reset?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    });
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
