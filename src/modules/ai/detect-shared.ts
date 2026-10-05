import { getConfig } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import type { EmbedDeps } from "./embedding/run";

export interface DetectConfig {
  duplicateMinSimilarity: number;
  duplicateWindowHours: number;
  incidentMinSimilarity: number;
  incidentWindowMinutes: number;
  incidentMinTickets: number;
}

export type DetectDeps = Partial<EmbedDeps> & { config?: DetectConfig };

export function resolveDetectConfig(deps: DetectDeps): DetectConfig {
  if (deps.config) return deps.config;
  const c = getConfig();
  return {
    duplicateMinSimilarity: c.AI_DUPLICATE_MIN_SIMILARITY,
    duplicateWindowHours: c.AI_DUPLICATE_WINDOW_HOURS,
    incidentMinSimilarity: c.AI_INCIDENT_MIN_SIMILARITY,
    incidentWindowMinutes: c.AI_INCIDENT_WINDOW_MINUTES,
    incidentMinTickets: c.AI_INCIDENT_MIN_TICKETS,
  };
}

export const dbOf = (deps: DetectDeps): Db => deps.db ?? getDb();
export const nowOf = (deps: DetectDeps): Date => (deps.now ?? (() => new Date()))();

/** O vetor de um chamado aberto, no formato que o pgvector aceita como parâmetro; `null` se não existir. */
export async function vectorLiteralOf(db: Db, ticketId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ v: string }[]>`SELECT "embedding"::text AS v FROM "OpenTicketVector" WHERE "ticketId" = ${ticketId}`;
  return rows[0]?.v ?? null;
}

