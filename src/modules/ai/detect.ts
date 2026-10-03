import type { Prisma } from "@/generated/prisma/client";
import { dbOf, nowOf, resolveDetectConfig, vectorLiteralOf, type DetectDeps } from "./detect-shared";
import { runEmbed } from "./embedding/run";
import { closeFinishedIncidents, detectIncident } from "./incidents";
import { signed, toVectorLiteral } from "./indexing";

export type { DetectConfig, DetectDeps } from "./detect-shared";

export interface DuplicateCandidate {
  ticketId: string;
  number: number;
  title: string;
  similarity: number;
}

const OPEN_STATUSES = ["NEW", "OPEN", "PENDING"];
const MAX_CANDIDATES = 3;
const POOL = 10;
const DESCRIPTION_LIMIT = 4000;

/**
 * Chamados abertos da MESMA equipe, das últimas horas da janela, parecidos com o chamado (nunca ele mesmo).
 * Os filtros estão na consulta: encerrado, equipe com IA desligada e outra equipe nunca aparecem.
 */
export async function findDuplicates(ticketId: string, deps: DetectDeps = {}): Promise<DuplicateCandidate[]> {
  const db = dbOf(deps);
  const cfg = resolveDetectConfig(deps);
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { teamId: true } });
  const vec = await vectorLiteralOf(db, ticketId);
  if (!ticket?.teamId || !vec) return [];
  const since = new Date(nowOf(deps).getTime() - cfg.duplicateWindowHours * 3600_000);
  const rows = await db.$queryRaw<{ ticketId: string; number: number; title: string; sim: number }[]>`
    SELECT t."id" AS "ticketId", t."number", t."title", 1 - (v."embedding" <=> ${vec}::vector) AS sim
    FROM "OpenTicketVector" v
    JOIN "Ticket" t ON t."id" = v."ticketId"
    JOIN "Team" tm ON tm."id" = t."teamId"
    WHERE t."id" <> ${ticketId}
      AND t."status" IN ('NEW', 'OPEN', 'PENDING')
      AND t."teamId" = ${ticket.teamId}
      AND tm."aiEnabled" = true
      AND t."createdAt" >= ${since}
    ORDER BY v."embedding" <=> ${vec}::vector
    LIMIT ${POOL}`;
  return rows
    .map((r) => ({ ticketId: r.ticketId, number: r.number, title: r.title, similarity: Number(r.sim) }))
    .filter((r) => r.similarity >= cfg.duplicateMinSimilarity)
    .slice(0, MAX_CANDIDATES);
}

/**
 * Mantém o vetor do chamado aberto e, a partir dele, sugere duplicados e detecta incidente.
 * Chamado encerrado ou de equipe com IA desligada sai do índice. Falha do provider propaga (o pg-boss repete);
 * IA desligada e teto estourado só encerram sem fazer nada.
 */
export async function detectForTicket(ticketId: string, deps: DetectDeps = {}): Promise<"detected" | "removed" | "skipped"> {
  const db = dbOf(deps);
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { team: { select: { aiEnabled: true } } } });
  if (!ticket) return "skipped";

  const remove = async (): Promise<"removed"> => {
    await db.$executeRaw`DELETE FROM "OpenTicketVector" WHERE "ticketId" = ${ticketId}`;
    await closeFinishedIncidents(dbOf(deps));
    return "removed";
  };
  if (!OPEN_STATUSES.includes(ticket.status)) return remove();
  if (ticket.team && !ticket.team.aiEnabled) return remove();

  const text = `${ticket.title}\n\n${ticket.description.slice(0, DESCRIPTION_LIMIT)}`;
  const hash = signed(deps, text);
  const existing = await db.$queryRaw<{ contentHash: string }[]>`SELECT "contentHash" FROM "OpenTicketVector" WHERE "ticketId" = ${ticketId}`;
  if (existing[0]?.contentHash !== hash) {
    const result = await runEmbed({ jobType: "detect", ticketId, texts: [text], kind: "document" }, deps);
    if (result.outcome !== "OK") return "skipped";
    const literal = toVectorLiteral(result.vectors[0]);
    await db.$executeRaw`
      INSERT INTO "OpenTicketVector" ("ticketId", "contentHash", "embedding", "createdAt")
      VALUES (${ticketId}, ${hash}, ${literal}::vector, now())
      ON CONFLICT ("ticketId") DO UPDATE SET "contentHash" = EXCLUDED."contentHash", "embedding" = EXCLUDED."embedding"`;
  }

  if (!(await db.aiSuggestion.findUnique({ where: { ticketId_kind: { ticketId, kind: "DUPLICATE" } } }))) {
    const candidates = await findDuplicates(ticketId, deps);
    if (candidates.length > 0) {
      try {
        await db.aiSuggestion.create({
          data: { ticketId, kind: "DUPLICATE", payload: { candidates } as unknown as Prisma.InputJsonValue, confidence: candidates[0].similarity },
        });
      } catch (err) {
        if ((err as { code?: string })?.code !== "P2002") throw err; // outra execução gravou primeiro
      }
    }
  }

  await detectIncident(ticketId, deps);
  return "detected";
}

