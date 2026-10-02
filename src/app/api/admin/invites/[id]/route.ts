import { NextResponse } from "next/server";
import { withAuth } from "@/lib/http";
import { revokeInvite } from "@/modules/admin";

type Params = { id: string };

export const DELETE = withAuth<Params>(async ({ user, params }) => {
  await revokeInvite(user, params.id);
  return NextResponse.json({ ok: true });
});
