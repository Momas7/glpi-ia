import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { setTeamAi } from "@/modules/ai";

const bodySchema = z.object({ enabled: z.boolean() }).strict();

type Params = { id: string };

export const PATCH = withAdmin<Params>(async ({ req, user, params }) => {
  const { enabled } = bodySchema.parse(await readJson(req));
  await setTeamAi(user, params.id, enabled);
  return NextResponse.json({ ok: true });
});
