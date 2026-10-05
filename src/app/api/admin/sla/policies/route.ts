import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { policiesSchema, updatePolicies } from "@/modules/sla";

const bodySchema = z.object({ policies: policiesSchema });

export const PUT = withAdmin(async ({ req, user }) => {
  const { policies } = bodySchema.parse(await readJson(req));
  await updatePolicies(user, policies);
  return NextResponse.json({ ok: true });
});
