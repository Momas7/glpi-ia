import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAdmin } from "@/lib/http";
import { businessHoursSchema, updateBusinessHours } from "@/modules/sla";

const bodySchema = z.object({ days: businessHoursSchema });

export const PUT = withAdmin(async ({ req, user }) => {
  const { days } = bodySchema.parse(await readJson(req));
  await updateBusinessHours(user, days);
  return NextResponse.json({ ok: true });
});
