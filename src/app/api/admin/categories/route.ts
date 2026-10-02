import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { createCategory, listCategories } from "@/modules/admin";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  parentId: z.string().min(1).optional(),
  defaultTeamId: z.string().min(1).optional(),
});

export const GET = withAdmin(async ({ user }) => NextResponse.json({ categories: await listCategories(user) }));

export const POST = withAdmin(async ({ req, user }) => {
  const input = bodySchema.parse(await readJson(req));
  return NextResponse.json({ category: await createCategory(user, input) }, { status: 201 });
});
