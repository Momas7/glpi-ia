import { createHash, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type Role = "REQUESTER" | "AGENT" | "TEAM_LEAD" | "ADMIN";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamIds: string[];
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sempre emite um token novo (sem reaproveitar sessão anterior). */
export async function createSession(userId: string): Promise<string> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    },
  });
  return token;
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await getDb().session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { teams: true } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    teamIds: user.teams.map((t) => t.teamId),
  };
}

export async function revokeSession(token: string): Promise<void> {
  await getDb().session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function revokeSessions(userId: string): Promise<void> {
  await getDb().session.deleteMany({ where: { userId } });
}
