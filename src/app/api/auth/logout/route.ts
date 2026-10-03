import { NextResponse } from "next/server";
import { instrument } from "@/lib/request-log";
import { SESSION_COOKIE, readSessionToken, revokeSession } from "@/modules/auth";

export function POST(req: Request) {
  return instrument(req, async () => {
    const token = readSessionToken(req);
    if (token) await revokeSession(token);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  });
}
