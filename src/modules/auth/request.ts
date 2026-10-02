import { SESSION_COOKIE, getSessionUser, type SessionUser } from "./session";

export function readSessionToken(req: Request): string | null {
  const match = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getRequestUser(req: Request): Promise<SessionUser | null> {
  const token = readSessionToken(req);
  return token ? getSessionUser(token) : null;
}
