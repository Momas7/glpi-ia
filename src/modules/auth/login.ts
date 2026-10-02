import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { hashPassword, verifyPassword } from "./password";
import { createSession, type SessionUser } from "./session";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export type LoginResult = { ok: true; sessionToken: string; user: SessionUser } | { ok: false };

let dummyHash: Promise<string> | undefined;

/** Gasta o mesmo tempo de uma verificação real quando a conta não existe/está bloqueada. */
async function burnVerification(password: string) {
  dummyHash ??= hashPassword("senha-descartavel-para-igualar-tempo");
  await verifyPassword(await dummyHash, password);
}

export async function login(input: { email: string; password: string; ip: string }): Promise<LoginResult> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email }, include: { teams: true } });

  if (!user || !user.active || !user.passwordHash || (user.lockedUntil && user.lockedUntil > new Date())) {
    await burnVerification(input.password);
    logger.warn({ ip: input.ip, userId: user?.id }, "login recusado");
    return { ok: false };
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const updated = await db.user.update({
      where: { id: user.id },
      data: { failedLogins: { increment: 1 } },
    });
    if (updated.failedLogins >= MAX_FAILED_LOGINS) {
      await db.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
      });
      logger.warn({ ip: input.ip, userId: user.id }, "conta bloqueada por tentativas excessivas");
    }
    return { ok: false };
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  const sessionToken = await createSession(user.id);
  return {
    ok: true,
    sessionToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      teamIds: user.teams.map((t) => t.teamId),
    },
  };
}
