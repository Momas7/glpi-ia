import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { updateCategory } from "@/modules/admin";

const bodySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    defaultTeamId: z.string().min(1).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar.");

type Params = { id: string };

export const PATCH = withAdmin<Params>(async ({ req, user, params }) => {
  const input = bodySchema.parse(await readJson(req));
  return NextResponse.json({ category: await updateCategory(user, params.id, input) });
});
