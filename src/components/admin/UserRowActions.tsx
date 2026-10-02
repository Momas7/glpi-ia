"use client";

import { Button } from "@/components/ui/button";
import { ROLE_LABEL } from "@/lib/labels";
import { useAction } from "./useAction";

export function UserRowActions({ id, role, active, isSelf }: { id: string; role: string; active: boolean; isSelf: boolean }) {
  const { run, error, pending } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Papel"
        defaultValue={role}
        disabled={isSelf || pending}
        onChange={(e) => run(`/api/admin/users/${id}`, "PATCH", { role: e.target.value })}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
      >
        {Object.entries(ROLE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant={active ? "outline" : "secondary"}
        disabled={isSelf || pending}
        onClick={() => run(`/api/admin/users/${id}`, "PATCH", { active: !active })}
      >
        {active ? "Desativar" : "Reativar"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const { run, error, pending } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/admin/invites/${id}`, "DELETE")}>
        Revogar
      </Button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
