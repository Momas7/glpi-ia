import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { changeRole, setActive } from "@/modules/admin";

const roleEnum = z.enum(["REQUESTER", "AGENT", "TEAM_LEAD", "ADMIN"]);
const bodySchema = z.union([z.object({ role: roleEnum }).strict(), z.object({ active: z.boolean() }).strict()]);

type Params = { id: string };

export const PATCH = withAdmin<Params>(async ({ req, user, params }) => {
  const body = bodySchema.parse(await readJson(req));
  const updated = "role" in body ? await changeRole(user, params.id, body.role) : await setActive(user, params.id, body.active);
  return NextResponse.json({ user: updated });
});
