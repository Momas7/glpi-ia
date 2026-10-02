import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSessionUser, type SessionUser } from "@/modules/auth";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getSessionUser(token) : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
