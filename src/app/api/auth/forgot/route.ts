import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, readJson, withErrors } from "@/lib/http";
import { checkRateLimit, requestReset } from "@/modules/auth";

const bodySchema = z.object({ email: z.string().email().max(254) });

export const POST = withErrors(async (req: Request) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  if (!checkRateLimit(`forgot:ip:${clientIp(req)}`, 5, 15 * 60)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente em instantes." }, { status: 429 });
  }
  // Limite por e-mail: impede bombardear a caixa de um colega mesmo trocando de IP.
  if (!checkRateLimit(`forgot:email:${parsed.data.email.toLowerCase()}`, 3, 15 * 60)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente em instantes." }, { status: 429 });
  }
  await requestReset(parsed.data.email);
  return NextResponse.json({ ok: true, message: "Se o e-mail estiver cadastrado, enviaremos as instruções." });
});
