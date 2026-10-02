"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/useAction";

export interface TeamOption {
  id: string;
  name: string;
  members: { id: string; name: string }[];
}

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

/** Ações do chamado conforme a permissão de quem vê: atribuir (líder/admin), assumir (técnico), reabrir/confirmar (solicitante). */
export function TicketActions({
  ticketId,
  canTake,
  canReopen,
  canAssign,
  teams,
  current,
}: {
  ticketId: string;
  canTake: boolean;
  canReopen: boolean;
  canAssign: boolean;
  teams: TeamOption[];
  current: { teamId: string | null; assigneeId: string | null };
}) {
  const { run, error, pending } = useAction();
  const [teamId, setTeamId] = useState(current.teamId ?? "");
  const [assigneeId, setAssigneeId] = useState(current.assigneeId ?? "");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!canTake && !canReopen && !canAssign) return null;

  const members = teams.find((t) => t.id === teamId)?.members ?? [];
  const shownError = localError ?? error;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-white/10 p-4 text-sm">
      {canAssign && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-team">Equipe</Label>
            <select
              id="assign-team"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setAssigneeId("");
              }}
              className={selectClass}
            >
              <option value="" disabled>
                Escolha a equipe
              </option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-user">Responsável</Label>
            <select id="assign-user" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectClass}>
              <option value="">Sem responsável</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(`/api/tickets/${ticketId}/assign`, "POST", {
                ...(teamId ? { teamId } : {}),
                assigneeId: assigneeId || null,
              })
            }
          >
            Salvar atribuição
          </Button>
        </div>
      )}

      {canTake && (
        <Button size="sm" className="self-start" disabled={pending} onClick={() => run(`/api/tickets/${ticketId}/take`, "POST")}>
          Assumir
        </Button>
      )}

      {canReopen && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">O chamado foi resolvido. Ficou tudo certo?</p>
          <Label htmlFor="reopen-reason">Motivo da reabertura</Label>
          <Textarea id="reopen-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (!reason.trim()) return setLocalError("Informe o motivo.");
                setLocalError(null);
                run(`/api/tickets/${ticketId}/reopen`, "POST", { reason: reason.trim() });
              }}
            >
              Reabrir
            </Button>
            <Button size="sm" disabled={pending} onClick={() => run(`/api/tickets/${ticketId}/confirm`, "POST")}>
              Confirmar fechamento
            </Button>
          </div>
        </div>
      )}

      {shownError && (
        <p role="alert" className="text-red-400">
          {shownError}
        </p>
      )}
    </section>
  );
}
