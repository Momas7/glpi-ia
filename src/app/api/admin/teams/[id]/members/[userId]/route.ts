import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/http";
import { removeMember } from "@/modules/admin";

type Params = { id: string; userId: string };

export const DELETE = withAdmin<Params>(async ({ user, params }) => {
  await removeMember(user, params.id, params.userId);
  return NextResponse.json({ ok: true });
});
