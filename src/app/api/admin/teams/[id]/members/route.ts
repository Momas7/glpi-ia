import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { addMember } from "@/modules/admin";

const bodySchema = z.object({ userId: z.string().min(1) });

type Params = { id: string };

export const POST = withAdmin<Params>(async ({ req, user, params }) => {
  const { userId } = bodySchema.parse(await readJson(req));
  await addMember(user, params.id, userId);
  return NextResponse.json({ ok: true });
});
