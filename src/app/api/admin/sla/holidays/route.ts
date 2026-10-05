import { NextResponse } from "next/server";
import { readJson, withAdmin } from "@/lib/http";
import { addHoliday, holidaySchema } from "@/modules/sla";

export const POST = withAdmin(async ({ req, user }) => {
  const input = holidaySchema.parse(await readJson(req));
  return NextResponse.json({ holiday: await addHoliday(user, input) }, { status: 201 });
});
