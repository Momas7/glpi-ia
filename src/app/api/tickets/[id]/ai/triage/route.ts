import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/http";
import { decideSuggestion, decisionSchema } from "@/modules/ai";

type Params = { id: string };

/** Aceita, edita ou rejeita a triagem sugerida pela IA. */
export const POST = withAuth<Params>(async ({ req, user, params }) => {
  const decision = decisionSchema.parse(await readJson(req));
  return NextResponse.json(await decideSuggestion(user, params.id, decision));
});
