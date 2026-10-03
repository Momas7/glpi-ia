import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { chunkText, contentHash } from "./chunking";
import { runEmbed, type EmbedDeps } from "./embedding/run";

export type IndexResult = "indexed" | "unchanged" | "removed";
export type IndexDeps = Partial<EmbedDeps>;

const dbOf = (deps: IndexDeps) => deps.db ?? getDb();

/** Literal que o pgvector entende: "[0.1,0.2,...]". Sempre passado como parâmetro, nunca concatenado ao SQL. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export function ticketKnowledgeText(t: { title: string; description: string; solution: string }): string {
  return `${t.title}\n\n${t.description}\n\nSolução: ${t.solution}`;
}

export async function indexArticle(articleId: string, deps: IndexDeps = {}): Promise<IndexResult> {
  const db = dbOf(deps);
  const article = await db.kbArticle.findUnique({ where: { id: articleId } });
  if (!article || !article.published) {
    await db.$executeRaw`DELETE FROM "KbChunk" WHERE "articleId" = ${articleId}`;
    return "removed";
  }

  const texts = chunkText(`${article.title}\n\n${article.body}`);
  const hashes = texts.map(contentHash);
  const existing = await db.$queryRaw<{ contentHash: string }[]>`
    SELECT "contentHash" FROM "KbChunk" WHERE "articleId" = ${articleId} ORDER BY "position"`;
  if (existing.length === hashes.length && existing.every((e, i) => e.contentHash === hashes[i])) return "unchanged";

  const result = await runEmbed({ jobType: "embed", texts, kind: "document" }, deps);
  if (result.outcome !== "OK") return "unchanged";

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "KbChunk" WHERE "articleId" = ${articleId}`;
    for (const [i, text] of texts.entries()) {
      await tx.$executeRaw`
        INSERT INTO "KbChunk" ("id", "articleId", "position", "text", "contentHash", "embedding")
        VALUES (${randomUUID()}, ${articleId}, ${i}, ${text}, ${hashes[i]}, ${toVectorLiteral(result.vectors[i])}::vector)`;
    }
  });
  return "indexed";
}

/** Solução do chamado: a escrita ao resolver; nos antigos, o último comentário público de um técnico. */
async function solutionOf(
  db: ReturnType<typeof dbOf>,
  ticket: { id: string; resolution: string | null; resolvedAt: Date | null },
): Promise<string | null> {
  if (ticket.resolution && ticket.resolution.trim() !== "") return ticket.resolution;
  const last = await db.comment.findFirst({
    where: {
      ticketId: ticket.id,
      internal: false,
      author: { role: { not: "REQUESTER" } },
      ...(ticket.resolvedAt ? { createdAt: { lte: ticket.resolvedAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  return last?.body ?? null;
}

export async function indexTicket(ticketId: string, deps: IndexDeps = {}): Promise<IndexResult> {
  const db = dbOf(deps);
  const remove = async (): Promise<IndexResult> => {
    await db.$executeRaw`DELETE FROM "TicketEmbedding" WHERE "ticketId" = ${ticketId}`;
    return "removed";
  };
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { rating: { select: { stars: true } } } });
  if (!ticket || (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED")) return remove();
  if (ticket.rating && ticket.rating.stars <= 2) return remove();
  const solution = await solutionOf(db, ticket);
  if (!solution) return remove();

  const text = ticketKnowledgeText({ title: ticket.title, description: ticket.description, solution });
  const hash = contentHash(text);
  const existing = await db.$queryRaw<{ contentHash: string }[]>`
    SELECT "contentHash" FROM "TicketEmbedding" WHERE "ticketId" = ${ticketId}`;
  if (existing[0]?.contentHash === hash) return "unchanged";

  const result = await runEmbed({ jobType: "embed", ticketId, texts: [text], kind: "document" }, deps);
  if (result.outcome !== "OK") return "unchanged";
  const literal = toVectorLiteral(result.vectors[0]);
  await db.$executeRaw`
    INSERT INTO "TicketEmbedding" ("ticketId", "contentHash", "embedding", "indexedAt")
    VALUES (${ticketId}, ${hash}, ${literal}::vector, now())
    ON CONFLICT ("ticketId") DO UPDATE SET "contentHash" = EXCLUDED."contentHash", "embedding" = EXCLUDED."embedding", "indexedAt" = now()`;
  return "indexed";
}

/**
 * Indexa tudo o que está pendente, em lotes e com pausa (planos gratuitos limitam as chamadas por minuto).
 * Idempotente: o que já está atualizado devolve "unchanged" sem chamar o provider, então retomar é rodar de novo.
 */
export async function reindexAll(
  opts: { batchSize?: number; pauseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  deps: IndexDeps = {},
): Promise<{ articles: number; tickets: number }> {
  const db = dbOf(deps);
  const batchSize = opts.batchSize ?? 10;
  const pauseMs = opts.pauseMs ?? 5000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const articleIds = (await db.kbArticle.findMany({ where: { published: true }, select: { id: true }, orderBy: { createdAt: "asc" } })).map((a) => a.id);
  const ticketIds = (
    await db.ticket.findMany({ where: { status: { in: ["RESOLVED", "CLOSED"] } }, select: { id: true }, orderBy: { createdAt: "asc" } })
  ).map((t) => t.id);
  const work = [
    ...articleIds.map((id) => ({ kind: "article" as const, id })),
    ...ticketIds.map((id) => ({ kind: "ticket" as const, id })),
  ];

  const done = { articles: 0, tickets: 0 };
  for (let i = 0; i < work.length; i += batchSize) {
    if (i > 0) await sleep(pauseMs);
    for (const item of work.slice(i, i + batchSize)) {
      const result = item.kind === "article" ? await indexArticle(item.id, deps) : await indexTicket(item.id, deps);
      if (result === "indexed") done[item.kind === "article" ? "articles" : "tickets"]++;
    }
  }
  return done;
}
