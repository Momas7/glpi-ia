import { NextResponse } from "next/server";
import { withAuth } from "@/lib/http";
import { confirmTicket } from "@/modules/tickets";

type Params = { id: string };

export const POST = withAuth<Params>(async ({ user, params }) =>
  NextResponse.json({ ticket: await confirmTicket(user, params.id) }),
);
