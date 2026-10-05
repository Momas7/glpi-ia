import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/http";
import { requestReindex } from "@/modules/ai";

/** Enfileira a reindexação de toda a base de conhecimento. */
export const POST = withAdmin(async ({ user }) => {
  await requestReindex(user);
  return NextResponse.json({ ok: true }, { status: 202 });
});
