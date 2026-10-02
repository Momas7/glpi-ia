import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { createTeam, listTeams } from "@/modules/admin";

const bodySchema = z.object({ name: z.string().trim().min(2).max(80) });

export const GET = withAdmin(async ({ user }) => NextResponse.json({ teams: await listTeams(user) }));

export const POST = withAdmin(async ({ req, user }) => {
  const { name } = bodySchema.parse(await readJson(req));
  return NextResponse.json({ team: await createTeam(user, name) }, { status: 201 });
});
