import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, readJson, withErrors } from "@/lib/http";
import { checkRateLimit, resetPassword } from "@/modules/auth";

const bodySchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1).max(256),
});

export const POST = withErrors(async (req: Request) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  if (!checkRateLimit(`reset:ip:${clientIp(req)}`, 10, 15 * 60)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente em instantes." }, { status: 429 });
  }
  const result = await resetPassword(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Link inválido ou expirado, ou senha não atende à política (mínimo 12 caracteres)." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
});
