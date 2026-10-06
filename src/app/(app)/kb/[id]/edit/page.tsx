import { notFound } from "next/navigation";
import { KbArticleForm } from "@/components/forms/KbArticleForm";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/server-session";
import { can } from "@/modules/auth";
import { getArticle } from "@/modules/kb";

export const metadata = { title: "Editar artigo · Sentinela" };

export default async function EditKbArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, "kb:manage")) notFound();
  const { id } = await params;
  const article = await getArticle(user, id).catch((err) => {
    if (err instanceof AppError) return null;
    throw err;
  });
  if (!article) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Editar artigo</h1>
      <KbArticleForm article={{ id: article.id, title: article.title, body: article.body, published: article.published }} />
    </div>
  );
}
