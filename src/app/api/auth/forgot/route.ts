import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/http";
import { checkRateLimit, requestReset } from "@/modules/auth";

const bodySchema = z.object({ email: z.string().email().max(254) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  if (!checkRateLimit(`forgot:ip:${clientIp(req)}`, 5, 15 * 60)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente em instantes." }, { status: 429 });
  }
  await requestReset(parsed.data.email);
  return NextResponse.json({ ok: true, message: "Se o e-mail estiver cadastrado, enviaremos as instruções." });
}
