import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/http";
import { removeHoliday } from "@/modules/sla";

type Params = { id: string };

export const DELETE = withAdmin<Params>(async ({ user, params }) => {
  await removeHoliday(user, params.id);
  return NextResponse.json({ ok: true });
});
