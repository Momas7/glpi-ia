import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/http";
import { retryDelivery } from "@/modules/integrations";

type Params = { id: string };

export const POST = withAdmin<Params>(async ({ user, params }) => {
  await retryDelivery(user, params.id);
  return NextResponse.json({ ok: true });
});
