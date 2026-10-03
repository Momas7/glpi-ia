import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { escapeLike } from "@/lib/like";
import { enqueueIndexArticle } from "@/modules/ai/enqueue";
import { recordAudit } from "@/modules/audit";
import { can, type SessionUser } from "@/modules/auth";

export const articleInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20_000),
});

export const articlePatchSchema = z
  .object({ title: articleInputSchema.shape.title, body: articleInputSchema.shape.body, published: z.boolean() })
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar.");

export type ArticleInput = z.infer<typeof articleInputSchema>;
export type ArticlePatch = z.infer<typeof articlePatchSchema>;

export interface KbArticleRow {
  id: string;
  title: string;
  published: boolean;
  updatedAt: Date;
  updatedByName: string;
}

const notFound = () => new NotFoundError("Artigo não encontrado.");

function assertRead(actor: SessionUser) {
  if (!can(actor, "kb:read")) throw new ForbiddenError();
}
function assertManage(actor: SessionUser) {
  if (!can(actor, "kb:manage")) throw new ForbiddenError();
}

export async function createArticle(actor: SessionUser, input: ArticleInput) {
  assertManage(actor);
  const data = articleInputSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    const article = await tx.kbArticle.create({ data: { ...data, createdById: actor.id, updatedById: actor.id } });
    await recordAudit(tx, { actorId: actor.id, action: "kb.create", targetType: "kb", targetId: article.id, data: { title: article.title } });
    return article;
  });
}

/** Edita título/texto e/ou publica e despublica, numa transação. Artigo que está ou estava publicado é reindexado. */
export async function patchArticle(actor: SessionUser, id: string, patch: ArticlePatch) {
  assertManage(actor);
  const data = articlePatchSchema.parse(patch);
  return getDb().$transaction(async (tx) => {
    const current = await tx.kbArticle.findUnique({ where: { id } });
    if (!current) throw notFound();
    const article = await tx.kbArticle.update({ where: { id }, data: { ...data, updatedById: actor.id } });
    const publishedChanged = data.published !== undefined && data.published !== current.published;
    const contentChanged = (data.title !== undefined && data.title !== current.title) || (data.body !== undefined && data.body !== current.body);
    if (contentChanged) {
      await recordAudit(tx, { actorId: actor.id, action: "kb.update", targetType: "kb", targetId: id, data: { title: article.title } });
    }
    if (publishedChanged) {
      await recordAudit(tx, { actorId: actor.id, action: article.published ? "kb.publish" : "kb.unpublish", targetType: "kb", targetId: id, data: { title: article.title } });
    }
    if ((contentChanged && (current.published || article.published)) || publishedChanged) await enqueueIndexArticle(tx, id);
    return article;
  });
}

export async function deleteArticle(actor: SessionUser, id: string): Promise<void> {
  assertManage(actor);
  await getDb().$transaction(async (tx) => {
    const current = await tx.kbArticle.findUnique({ where: { id } });
    if (!current) throw notFound();
    await tx.kbArticle.delete({ where: { id } }); // os trechos saem em cascata
    await recordAudit(tx, { actorId: actor.id, action: "kb.delete", targetType: "kb", targetId: id, data: { title: current.title } });
  });
}

export async function listArticles(actor: SessionUser, opts: { q?: string } = {}): Promise<KbArticleRow[]> {
  assertRead(actor);
  const where: Prisma.KbArticleWhereInput = {
    ...(can(actor, "kb:manage") ? {} : { published: true }),
    ...(opts.q ? { title: { contains: escapeLike(opts.q), mode: "insensitive" } } : {}),
  };
  const rows = await getDb().kbArticle.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { updatedBy: { select: { name: true } } },
  });
  return rows.map((a) => ({ id: a.id, title: a.title, published: a.published, updatedAt: a.updatedAt, updatedByName: a.updatedBy.name }));
}

export async function getArticle(actor: SessionUser, id: string) {
  assertRead(actor);
  const article = await getDb().kbArticle.findUnique({ where: { id }, include: { updatedBy: { select: { name: true } } } });
  if (!article || (!article.published && !can(actor, "kb:manage"))) throw notFound();
  return article;
}
