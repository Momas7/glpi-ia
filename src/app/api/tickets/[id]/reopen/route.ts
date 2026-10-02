import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/http";
import { reopenSchema, reopenTicket } from "@/modules/tickets";

type Params = { id: string };

export const POST = withAuth<Params>(async ({ req, user, params }) => {
  const { reason } = reopenSchema.parse(await readJson(req));
  return NextResponse.json({ ticket: await reopenTicket(user, params.id, reason) });
});
