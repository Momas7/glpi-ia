import { getDb } from "@/lib/db";
import { signed, toVectorLiteral } from "./embed-utils";
import { runEmbed, type EmbedDeps } from "./embedding/run";

const OPEN_STATUSES = ["NEW", "OPEN", "PENDING"];
const DESCRIPTION_LIMIT = 4000;

/**
 * Mantém só o vetor do chamado aberto (sem sugerir duplicados nem agrupar incidentes).
 * Encerrado ou de equipe com a IA desligada perde o vetor; hash igual (mesmo texto, provider e modelo) não gasta cota.
 */
export async function refreshOpenVector(
  ticketId: string,
  deps: Partial<EmbedDeps> = {},
): Promise<"indexed" | "unchanged" | "removed" | "skipped"> {
  const db = deps.db ?? getDb();
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { team: { select: { aiEnabled: true } } } });
  if (!ticket) return "skipped";
  if (!OPEN_STATUSES.includes(ticket.status) || (ticket.team && !ticket.team.aiEnabled)) {
    await db.$executeRaw`DELETE FROM "OpenTicketVector" WHERE "ticketId" = ${ticketId}`;
    return "removed";
  }

  const text = `${ticket.title}\n\n${ticket.description.slice(0, DESCRIPTION_LIMIT)}`;
  const hash = signed(deps, text);
  const existing = await db.$queryRaw<{ contentHash: string }[]>`SELECT "contentHash" FROM "OpenTicketVector" WHERE "ticketId" = ${ticketId}`;
  if (existing[0]?.contentHash === hash) return "unchanged";

  const result = await runEmbed({ jobType: "detect", ticketId, texts: [text], kind: "document" }, deps);
  if (result.outcome !== "OK") return "skipped";
  const literal = toVectorLiteral(result.vectors[0]);
  await db.$executeRaw`
    INSERT INTO "OpenTicketVector" ("ticketId", "contentHash", "embedding", "createdAt")
    VALUES (${ticketId}, ${hash}, ${literal}::vector, now())
    ON CONFLICT ("ticketId") DO UPDATE SET "contentHash" = EXCLUDED."contentHash", "embedding" = EXCLUDED."embedding"`;
  return "indexed";
}
