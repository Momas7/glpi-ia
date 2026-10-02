import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/http";
import { acceptInvite, checkRateLimit } from "@/modules/auth";

const bodySchema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  if (!checkRateLimit(`invite:ip:${clientIp(req)}`, 10, 15 * 60)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente em instantes." }, { status: 429 });
  }
  const result = await acceptInvite(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Convite inválido ou expirado, ou senha não atende à política (mínimo 12 caracteres)." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
