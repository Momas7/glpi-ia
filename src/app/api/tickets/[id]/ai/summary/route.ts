import { NextResponse } from "next/server";
import { withAuth } from "@/lib/http";
import { summarizeTicket } from "@/modules/ai";

type Params = { id: string };

/** Resume (ou atualiza o resumo de) a conversa do chamado. Só para quem pode atendê-lo. */
export const POST = withAuth<Params>(async ({ user, params }) => NextResponse.json(await summarizeTicket(user, params.id)));
