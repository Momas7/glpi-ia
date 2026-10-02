import { NextResponse } from "next/server";
import { z } from "zod";
import { createInvite, getRequestUser } from "@/modules/auth";

const bodySchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(["REQUESTER", "AGENT", "TEAM_LEAD", "ADMIN"]),
});

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const { inviteUrl } = await createInvite({ ...parsed.data, createdById: user.id });
  return NextResponse.json({ inviteUrl });
}
