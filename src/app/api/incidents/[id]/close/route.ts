import { NextResponse } from "next/server";
import { withAuth } from "@/lib/http";
import { closeIncident } from "@/modules/ai";

type Params = { id: string };

/** Encerra o incidente à mão (líder da equipe afetada ou admin). */
export const POST = withAuth<Params>(async ({ user, params }) => {
  await closeIncident(user, params.id);
  return NextResponse.json({ ok: true });
});
