import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAuth } from "@/lib/http";
import { can, createInvite } from "@/modules/auth";

const bodySchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(["REQUESTER", "AGENT", "TEAM_LEAD", "ADMIN"]),
});

export const POST = withAuth(async ({ req, user }) => {
  if (!can(user, "user:invite")) return jsonError(403, "Sem permissão.");
  const input = bodySchema.parse(await readJson(req));
  const { inviteUrl } = await createInvite({ ...input, createdById: user.id });
  return NextResponse.json({ inviteUrl });
});
