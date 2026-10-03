"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, sendJson } from "@/lib/client-api";

export interface DraftSource {
  kind: "article" | "ticket";
  id: string;
  number?: number;
  title: string;
}

const MESSAGES: Record<string, string> = {
  NO_SOURCES: "Não encontrei conhecimento relacionado a este chamado. Escreva a resposta manualmente.",
  NO_VALID_ANSWER: "A IA não conseguiu montar uma resposta apoiada nas fontes. Tente de novo ou responda manualmente.",
  DISABLED: "A IA está desligada.",
  BUDGET: "O limite diário de gasto com IA foi atingido. Tente amanhã ou responda manualmente.",
};

/** Rascunho de resposta da IA com fontes: o técnico edita e publica por conta própria; nada é enviado sozinho. */
export function AiDraftCard({
  ticketId,
  available,
  draft,
}: {
  ticketId: string;
  available: boolean;
  draft: { id: string; text: string; sources: DraftSource[] } | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(draft?.text ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!available) return null;
  const url = `/api/tickets/${ticketId}/ai/draft`;

  async function generate() {
    setError(null);
    setNotice(null);
    setPending(true);
    const result = await sendJson<{ outcome?: string }>(url, "POST");
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    const outcome = result.data.outcome ?? "";
    if (outcome === "DRAFTED") return router.refresh(); // o novo rascunho tem outro id: a página remonta o cartão
    setNotice(MESSAGES[outcome] ?? "Não foi possível gerar o rascunho.");
  }

  async function discard() {
    setError(null);
    setPending(true);
    const result = await sendJson(url, "DELETE");
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    router.refresh();
  }

  async function publish() {
    setError(null);
    setPending(true);
    const posted = await sendJson(`/api/tickets/${ticketId}/comments`, "POST", { body: text.trim(), internal: false });
    if (!posted.ok) {
      setPending(false);
      return setError(errorMessage(posted));
    }
    const removed = await sendJson(url, "DELETE");
    setPending(false);
    if (!removed.ok) return setError(errorMessage(removed));
    router.refresh();
  }

  if (!draft) {
    return (
      <section aria-label="Sugestão de resposta" className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={generate}>
            {pending ? "Gerando…" : "Sugerir resposta"}
          </Button>
          {error && (
            <span role="alert" className="text-red-400">
              {error}
            </span>
          )}
        </div>
        {notice && (
          <p role="status" className="text-muted-foreground">
            {notice}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Rascunho da IA" className="flex flex-col gap-3 rounded-lg border border-violet-500/40 bg-violet-500/5 p-4 text-sm">
      <h2 className="font-medium">Rascunho da IA</h2>
      <p className="text-xs text-muted-foreground">Revise antes de publicar. Só você vê este rascunho; nada foi enviado ao solicitante.</p>
      <Label htmlFor="ai-draft-text">Rascunho de resposta</Label>
      <Textarea id="ai-draft-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Fontes usadas</p>
        <ul className="flex flex-col gap-1">
          {draft.sources.map((s) => (
            <li key={`${s.kind}-${s.id}`}>
              <Link href={s.kind === "article" ? `/kb/${s.id}` : `/tickets/${s.id}`} className="underline underline-offset-4">
                {s.kind === "article" ? s.title : `Chamado #${s.number} · ${s.title}`}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || text.trim() === ""} onClick={publish}>
          Publicar como comentário
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={generate}>
          Regenerar
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={discard}>
          Descartar
        </Button>
        {error && (
          <span role="alert" className="text-red-400">
            {error}
          </span>
        )}
      </div>
      {notice && (
        <p role="status" className="text-muted-foreground">
          {notice}
        </p>
      )}
    </section>
  );
}
