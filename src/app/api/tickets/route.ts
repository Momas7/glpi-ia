import { NextResponse } from "next/server";
import { withAuth, readJson } from "@/lib/http";
import { createTicket, createTicketSchema, listQuerySchema, listTickets } from "@/modules/tickets";

export const GET = withAuth(async ({ req, user }) => {
  const query = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await listTickets(user, query));
});

export const POST = withAuth(async ({ req, user }) => {
  const input = createTicketSchema.parse(await readJson(req));
  return NextResponse.json({ ticket: await createTicket(user, input) }, { status: 201 });
});
