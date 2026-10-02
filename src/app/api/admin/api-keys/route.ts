import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { API_SCOPES, createApiKey, listApiKeys } from "@/modules/integrations";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

export const GET = withAdmin(async ({ user }) => NextResponse.json({ keys: await listApiKeys(user) }));

export const POST = withAdmin(async ({ req, user }) => {
  const input = bodySchema.parse(await readJson(req));
  return NextResponse.json(await createApiKey(user, input), { status: 201 });
});
