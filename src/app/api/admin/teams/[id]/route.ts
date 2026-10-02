import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { renameTeam } from "@/modules/admin";

const bodySchema = z.object({ name: z.string().trim().min(2).max(80) });

type Params = { id: string };

export const PATCH = withAdmin<Params>(async ({ req, user, params }) => {
  const { name } = bodySchema.parse(await readJson(req));
  return NextResponse.json({ team: await renameTeam(user, params.id, name) });
});
