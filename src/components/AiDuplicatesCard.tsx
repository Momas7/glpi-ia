"use client";

import Link from "next/link";
import { useAction } from "@/components/useAction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/labels";

export interface DuplicatesSuggestion {
  id: string;
  candidates: { id: string; number: number; title: string; status: string; similarity: number; canOpen: boolean }[];
}

/** Chamados abertos parecidos com este. Só avisa: o técnico decide, e nada é vinculado nem fechado. */
export function AiDuplicatesCard({ ticketId, suggestion }: { ticketId: string; suggestion: DuplicatesSuggestion }) {
  const { run, error, pending } = useAction();
  return (
    <section aria-label="Possíveis duplicados" className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <h2 className="font-medium">Possíveis duplicados</h2>
      <p className="text-xs text-muted-foreground">Chamados abertos da sua equipe que parecem tratar do mesmo problema.</p>
      <ul className="flex flex-col gap-1">
        {suggestion.candidates.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            {c.canOpen ? (
              <Link href={`/tickets/${c.id}`} className="underline underline-offset-4">
                #{c.number} · {c.title}
              </Link>
            ) : (
              <span>
                #{c.number} · {c.title}
              </span>
            )}
            <Badge variant="outline">{STATUS_LABEL[c.status] ?? c.status}</Badge>
            <span className="text-xs text-muted-foreground">{Math.round(c.similarity * 100)}% parecido</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/tickets/${ticketId}/ai/duplicates`, "POST", { action: "dismiss" })}>
          Não é duplicado
        </Button>
        {error && (
          <span role="alert" className="text-red-400">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
