import { NextResponse } from "next/server";
import { SESSION_COOKIE, revokeSession } from "@/modules/auth";

export async function POST(req: Request) {
  const token = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) await revokeSession(decodeURIComponent(token));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
