import { NextResponse } from "next/server";
import { withAuth, readJson } from "@/lib/http";
import { TicketNotFoundError, changeStatus, getTicket, patchTicketSchema, updateTicket } from "@/modules/tickets";

type Params = { id: string };

export const GET = withAuth<Params>(async ({ user, params }) => {
  const ticket = await getTicket(user, params.id);
  if (!ticket) throw new TicketNotFoundError();
  return NextResponse.json({ ticket });
});

export const PATCH = withAuth<Params>(async ({ req, user, params }) => {
  const { status, ...fields } = patchTicketSchema.parse(await readJson(req));
  let ticket = await getTicket(user, params.id);
  if (!ticket) throw new TicketNotFoundError();
  if (Object.keys(fields).length > 0) ticket = await updateTicket(user, params.id, fields);
  if (status) ticket = await changeStatus(user, params.id, status);
  return NextResponse.json({ ticket });
});
