import { NextResponse } from "next/server";
import { instrument } from "@/lib/request-log";
import { checkReadiness } from "@/modules/system";

export const dynamic = "force-dynamic";

/** Verificação completa (banco, vetor, migrações, fila e worker). Sem autenticação, por isso só estados fixos. */
export function GET(req: Request) {
  return instrument(req, async () => {
    const readiness = await checkReadiness();
    return NextResponse.json(readiness, { status: readiness.status === "ok" ? 200 : 503 });
  });
}
