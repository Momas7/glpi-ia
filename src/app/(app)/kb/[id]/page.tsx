import Link from "next/link";
import { notFound } from "next/navigation";
import { KbArticleActions } from "@/components/forms/KbArticleActions";
import { SafeText } from "@/components/SafeText";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { can } from "@/modules/auth";
import { getArticle } from "@/modules/kb";

export const metadata = { title: "Artigo · Sistema de Chamados" };

export default async function KbArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const article = await getArticle(user, id).catch((err) => {
    if (err instanceof AppError) return null;
    throw err;
  });
  if (!article) notFound();
  const manage = can(user, "kb:manage");

  return (
    <article className="flex max-w-3xl flex-col gap-4">
      <Link href="/kb" className="text-sm text-muted-foreground hover:text-foreground">
        ← Base de conhecimento
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{article.title}</h1>
        {manage && (article.published ? <Badge>Publicado</Badge> : <Badge variant="outline">Rascunho</Badge>)}
      </div>
      <p className="text-xs text-muted-foreground">
        Atualizado em {formatDateTime(article.updatedAt)} por {article.updatedBy.name}
      </p>
      {manage && (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/kb/${article.id}/edit`} className={buttonVariants({ size: "sm" })}>
            Editar
          </Link>
          <KbArticleActions id={article.id} published={article.published} />
        </div>
      )}
      <SafeText value={article.body} className="prose-sm space-y-2 rounded-lg border border-white/10 p-4" />
    </article>
  );
}
