import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/http";
import { assignTicket, assignTicketSchema } from "@/modules/tickets";

type Params = { id: string };

export const POST = withAuth<Params>(async ({ req, user, params }) => {
  const input = assignTicketSchema.parse(await readJson(req));
  return NextResponse.json({ ticket: await assignTicket(user, params.id, input) });
});
