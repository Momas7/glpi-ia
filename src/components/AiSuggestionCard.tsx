"use client";

import { useState } from "react";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PRIORITY_LABEL } from "@/lib/labels";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

export interface AiSuggestionView {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  teamId: string | null;
  teamName: string | null;
  confidence: number;
  options: { categories: { id: string; name: string }[]; teams: { id: string; name: string }[] };
}

/** Sugestão de triagem da IA: o técnico aceita, edita ou rejeita. Nada é aplicado sem um clique. */
export function AiSuggestionCard({ ticketId, suggestion }: { ticketId: string; suggestion: AiSuggestionView }) {
  const { run, error, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [categoryId, setCategoryId] = useState(suggestion.categoryId ?? "");
  const [priority, setPriority] = useState(suggestion.priority);
  const [teamId, setTeamId] = useState(suggestion.teamId ?? "");
  const url = `/api/tickets/${ticketId}/ai/triage`;

  return (
    <section aria-label="Sugestão da IA" className="flex flex-col gap-3 rounded-lg border border-violet-500/40 bg-violet-500/5 p-4 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="font-medium">Sugestão da IA</h2>
        <span className="text-xs text-muted-foreground">Confiança {Math.round(suggestion.confidence * 100)}%</span>
      </header>

      {!editing ? (
        <dl className="grid grid-cols-3 gap-3">
          <Field label="Categoria" value={suggestion.categoryName ?? "manter a atual"} />
          <Field label="Prioridade" value={PRIORITY_LABEL[suggestion.priority]} />
          <Field label="Equipe" value={suggestion.teamName ?? "manter a atual"} />
        </dl>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-category">Categoria</Label>
            <select id="ai-category" className={selectClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sem categoria</option>
              {suggestion.options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-priority">Prioridade</Label>
            <select id="ai-priority" className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-team">Equipe</Label>
            <select id="ai-team" className={selectClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Manter a atual</option>
              {suggestion.options.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!editing ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => run(url, "POST", { action: "accept" })}>
              Aceitar
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(url, "POST", { action: "reject" })}>
              Rejeitar
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(url, "POST", {
                  action: "edit",
                  fields: { categoryId: categoryId || null, priority, teamId: teamId || null },
                })
              }
            >
              Aplicar
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </>
        )}
        {error && (
          <span role="alert" className="text-sm text-red-400">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
