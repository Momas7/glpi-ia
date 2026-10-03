import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { can, type SessionUser } from "@/modules/auth";
import { runEmbed, type EmbedDeps } from "./embedding/run";
import { ticketSolution, toVectorLiteral } from "./indexing";

export type KnowledgeSource =
  | { kind: "article"; id: string; title: string; excerpt: string; similarity: number }
  | { kind: "ticket"; id: string; number: number; title: string; excerpt: string; similarity: number };

const DEFAULT_K = 6;
const MAX_CHUNKS_PER_ARTICLE = 2;
const POOL = 50;
const EXCERPT_LIMIT = 500;

interface ArticleRow {
  articleId: string;
  title: string;
  text: string;
  sim: number;
}
interface TicketRow {
  id: string;
  number: number;
  title: string;
  resolution: string | null;
  resolvedAt: Date | null;
  sim: number;
}

const excerpt = (text: string) => (text.length > EXCERPT_LIMIT ? `${text.slice(0, EXCERPT_LIMIT - 1)}…` : text);

/**
 * Busca por similaridade de cosseno nas duas fontes do RAG. Todos os filtros de segurança estão na própria
 * consulta (artigo publicado; chamado resolvido, visível ao ator e sem nota baixa; nunca o próprio chamado),
 * então conteúdo retirado some da busca na hora, mesmo antes de o job de indexação rodar.
 */
export async function searchKnowledge(
  actor: SessionUser,
  query: { ticketId: string; text: string },
  opts: { k?: number; minSimilarity?: number } = {},
  deps: Partial<EmbedDeps> = {},
): Promise<KnowledgeSource[]> {
  if (!can(actor, "kb:read")) throw new ForbiddenError();
  const db = deps.db ?? getDb();
  const k = opts.k ?? DEFAULT_K;
  const minSimilarity = opts.minSimilarity ?? getConfig().AI_RAG_MIN_SIMILARITY;

  const embedded = await runEmbed({ jobType: "search", ticketId: query.ticketId, texts: [query.text], kind: "query" }, deps);
  if (embedded.outcome !== "OK") return [];
  const vec = toVectorLiteral(embedded.vectors[0]);
  const isAdmin = actor.role === "ADMIN";

  const { articles, tickets } = await db.$transaction(async (tx) => {
    // Com filtros depois do índice HNSW, a busca precisa continuar procurando até achar linhas que passem (pgvector ≥ 0.8).
    await tx.$queryRaw`SELECT '[1]'::vector`; // carrega a extensão, que define o parâmetro abaixo
    const supported = await tx.$queryRaw<{ v: string | null }[]>`SELECT current_setting('hnsw.iterative_scan', true) AS v`;
    if (supported[0]?.v !== null && supported[0]?.v !== undefined) await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`);

    const articles = await tx.$queryRaw<ArticleRow[]>`
      SELECT a."id" AS "articleId", a."title", c."text", 1 - (c."embedding" <=> ${vec}::vector) AS sim
      FROM "KbChunk" c
      JOIN "KbArticle" a ON a."id" = c."articleId"
      WHERE a."published" = true AND c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> ${vec}::vector
      LIMIT ${POOL}`;

    const tickets = await tx.$queryRaw<TicketRow[]>`
      SELECT t."id", t."number", t."title", t."resolution", t."resolvedAt", 1 - (e."embedding" <=> ${vec}::vector) AS sim
      FROM "TicketEmbedding" e
      JOIN "Ticket" t ON t."id" = e."ticketId"
      WHERE t."status" IN ('RESOLVED', 'CLOSED')
        AND t."id" <> ${query.ticketId}
        AND NOT EXISTS (SELECT 1 FROM "TicketRating" r WHERE r."ticketId" = t."id" AND r."stars" <= 2)
        AND (${isAdmin} OR t."teamId" = ANY(${actor.teamIds}::text[]) OR t."assigneeId" = ${actor.id} OR t."requesterId" = ${actor.id})
      ORDER BY e."embedding" <=> ${vec}::vector
      LIMIT ${POOL}`;
    return { articles, tickets };
  });

  const perArticle = new Map<string, number>();
  const sources: KnowledgeSource[] = [];
  for (const a of articles) {
    const sim = Number(a.sim);
    if (sim < minSimilarity) continue;
    const used = perArticle.get(a.articleId) ?? 0;
    if (used >= MAX_CHUNKS_PER_ARTICLE) continue;
    perArticle.set(a.articleId, used + 1);
    sources.push({ kind: "article", id: a.articleId, title: a.title, excerpt: excerpt(a.text), similarity: sim });
  }
  for (const t of tickets) {
    const sim = Number(t.sim);
    if (sim < minSimilarity) continue;
    const solution = (await ticketSolution(db, { id: t.id, resolution: t.resolution, resolvedAt: t.resolvedAt })) ?? "";
    sources.push({ kind: "ticket", id: t.id, number: t.number, title: t.title, excerpt: excerpt(solution), similarity: sim });
  }
  return sources.sort((x, y) => y.similarity - x.similarity).slice(0, k);
}
