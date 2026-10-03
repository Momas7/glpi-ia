import { NextResponse } from "next/server";
import { withAuth } from "@/lib/http";
import { discardDraft, suggestDraft } from "@/modules/ai";

type Params = { id: string };

/** Gera (ou substitui) o rascunho de resposta com citações. Só para quem pode atender o chamado. */
export const POST = withAuth<Params>(async ({ user, params }) => NextResponse.json(await suggestDraft(user, params.id)));

/** Descarta o rascunho. */
export const DELETE = withAuth<Params>(async ({ user, params }) => {
  await discardDraft(user, params.id);
  return NextResponse.json({ ok: true });
});
