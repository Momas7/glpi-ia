import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuth } from "@/lib/http";
import { dismissDuplicates } from "@/modules/ai";

type Params = { id: string };

const bodySchema = z.object({ action: z.literal("dismiss") }).strict();

/** "Não é duplicado": descarta a sugestão de possíveis duplicados. */
export const POST = withAuth<Params>(async ({ req, user, params }) => {
  bodySchema.parse(await readJson(req));
  await dismissDuplicates(user, params.id);
  return NextResponse.json({ ok: true });
});
