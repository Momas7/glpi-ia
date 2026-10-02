import { NextResponse } from "next/server";
import { withAuth } from "@/lib/http";
import { takeTicket } from "@/modules/tickets";

type Params = { id: string };

export const POST = withAuth<Params>(async ({ user, params }) =>
  NextResponse.json({ ticket: await takeTicket(user, params.id) }),
);
