import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/http";
import { revokeInvite } from "@/modules/admin";

type Params = { id: string };

export const DELETE = withAdmin<Params>(async ({ user, params }) => {
  await revokeInvite(user, params.id);
  return NextResponse.json({ ok: true });
});
