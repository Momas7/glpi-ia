import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/http";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, checkRateLimit, login } from "@/modules/auth";

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const allowed =
    checkRateLimit(`login:ip:${ip}`, 20, 60) &&
    checkRateLimit(`login:email:${email.toLowerCase()}`, 10, 15 * 60);
  if (!allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente em instantes." }, { status: 429 });
  }

  const result = await login({ email, password, ip });
  if (!result.ok) {
    return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
  }

  const res = NextResponse.json({ user: result.user });
  res.cookies.set(SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
