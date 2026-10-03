import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/http";
import { TicketNotFoundError, getTicket, patchTicket, patchTicketSchema } from "@/modules/tickets";

type Params = { id: string };

export const GET = withAuth<Params>(async ({ user, params }) => {
  const ticket = await getTicket(user, params.id);
  if (!ticket) throw new TicketNotFoundError();
  return NextResponse.json({ ticket });
});

export const PATCH = withAuth<Params>(async ({ req, user, params }) => {
  const { status, resolution, ...fields } = patchTicketSchema.parse(await readJson(req));
  const ticket = await patchTicket(user, params.id, { fields, status, resolution });
  return NextResponse.json({ ticket });
});
