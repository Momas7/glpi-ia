import { notFound } from "next/navigation";
import { KbArticleForm } from "@/components/forms/KbArticleForm";
import { requireUser } from "@/lib/server-session";
import { can } from "@/modules/auth";

export const metadata = { title: "Novo artigo · Sentinela" };

export default async function NewKbArticlePage() {
  const user = await requireUser();
  if (!can(user, "kb:manage")) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Novo artigo</h1>
      <KbArticleForm />
    </div>
  );
}
