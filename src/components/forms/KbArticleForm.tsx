"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, sendJson } from "@/lib/client-api";

interface Props {
  article?: { id: string; title: string; body: string; published: boolean };
}

/** Novo artigo e edição. Artigo novo ou em rascunho oferece salvar e publicar; publicado só salva alterações. */
export function KbArticleForm({ article }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [title, setTitle] = useState(article?.title ?? "");
  const [body, setBody] = useState(article?.body ?? "");

  async function save(publish: boolean) {
    setError(null);
    setPending(true);
    const result = article
      ? await sendJson<{ article: { id: string } }>(`/api/kb/${article.id}`, "PATCH", { title, body })
      : await sendJson<{ article: { id: string } }>("/api/kb", "POST", { title, body });
    if (!result.ok) {
      setPending(false);
      return setError(errorMessage(result));
    }
    const id = article?.id ?? result.data.article.id;
    if (publish) {
      const published = await sendJson(`/api/kb/${id}`, "PATCH", { published: true });
      if (!published.ok) {
        setPending(false);
        return setError(errorMessage(published));
      }
    }
    router.push(`/kb/${id}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kb-title">Título</Label>
        <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kb-body">Texto</Label>
        <Textarea id="kb-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} maxLength={20000} required />
        <p className="text-xs text-muted-foreground">Markdown simples: negrito, itálico, código, listas. HTML não é aceito.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {article?.published ? "Salvar alterações" : "Salvar rascunho"}
        </Button>
        {!article?.published && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void save(true)}>
            Publicar
          </Button>
        )}
        {error && (
          <span role="alert" className="text-sm text-red-400">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
