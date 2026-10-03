"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/client-api";

const MIN_COMMENTS = 3;

const MESSAGES: Record<string, string> = {
  TOO_SHORT: "A conversa tem poucos comentários para resumir.",
  DISABLED: "A IA está desligada.",
  BUDGET: "O limite diário de gasto com IA foi atingido. Tente amanhã.",
};

export interface SummaryViewProps {
  available: boolean;
  commentCount: number;
  summary: { text: string; commentCount: number; newComments: number } | null;
}

/** Resumo da conversa do chamado (só equipe). Gerado sob demanda; avisa quando a conversa avançou. */
export function AiSummaryCard({ ticketId, view }: { ticketId: string; view: SummaryViewProps }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!view.available) return null;
  const missing = Math.max(0, MIN_COMMENTS - view.commentCount);

  async function generate() {
    setError(null);
    setNotice(null);
    setPending(true);
    const result = await sendJson<{ outcome?: string }>(`/api/tickets/${ticketId}/ai/summary`, "POST");
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    const outcome = result.data.outcome ?? "";
    if (outcome === "SUMMARIZED") return router.refresh();
    setNotice(MESSAGES[outcome] ?? "Não foi possível resumir a conversa.");
  }

  return (
    <section aria-label="Resumo da conversa" className="flex flex-col gap-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-4 text-sm">
      <h2 className="font-medium">Resumo da conversa</h2>
      {view.summary ? (
        <>
          <p className="whitespace-pre-wrap">{view.summary.text}</p>
          <p className="text-xs text-muted-foreground">
            Gerado pela IA · cobre {view.summary.commentCount} comentários · visível só à equipe
          </p>
          {view.summary.newComments > 0 && (
            <p className="text-xs text-amber-300">
              Atenção: há {view.summary.newComments} comentários novos desde este resumo.
            </p>
          )}
        </>
      ) : (
        missing > 0 && (
          <p className="text-xs text-muted-foreground">Ainda não vale resumir: faltam {missing} comentários (mínimo de {MIN_COMMENTS}).</p>
        )
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending || (!view.summary && missing > 0)} onClick={generate}>
          {pending ? "Resumindo…" : view.summary ? "Atualizar resumo" : "Resumir conversa"}
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
