import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/http";
import { revokeApiKey } from "@/modules/integrations";

type Params = { id: string };

export const DELETE = withAdmin<Params>(async ({ user, params }) => {
  await revokeApiKey(user, params.id);
  return NextResponse.json({ ok: true });
});
