import { NextResponse } from "next/server";
import { z } from "zod";
import { readOptionalJson, withAuth } from "@/lib/http";
import { confirmTicket, ratingSchema } from "@/modules/tickets";

type Params = { id: string };

const bodySchema = z.object({ rating: ratingSchema.optional() }).strict();

/** Confirma o fechamento. O corpo é opcional: `{ rating: { stars, comment? } }` avalia o atendimento no mesmo passo. */
export const POST = withAuth<Params>(async ({ req, user, params }) => {
  const body = bodySchema.parse((await readOptionalJson(req)) ?? {});
  return NextResponse.json({ ticket: await confirmTicket(user, params.id, body.rating) });
});
