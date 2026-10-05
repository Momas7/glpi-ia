import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/http";
import { rateTicket, ratingSchema } from "@/modules/tickets";

type Params = { id: string };

/** Avaliação do atendimento (uma por chamado, só o solicitante). */
export const POST = withAuth<Params>(async ({ req, user, params }) => {
  const input = ratingSchema.parse(await readJson(req));
  return NextResponse.json({ rating: await rateTicket(user, params.id, input) }, { status: 201 });
});
