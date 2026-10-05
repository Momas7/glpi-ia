"use client";

import { Button } from "@/components/ui/button";
import { useAction } from "@/components/useAction";

export function AiTeamToggle({ teamId, name, enabled }: { teamId: string; name: string; enabled: boolean }) {
  const { run, error, pending } = useAction();
  return (
    <div className="flex items-center gap-3">
      <span className="w-48">{name}</span>
      <Button
        size="sm"
        variant={enabled ? "default" : "outline"}
        disabled={pending}
        aria-pressed={enabled}
        aria-label={`Triagem por IA da equipe ${name}`}
        onClick={() => run(`/api/admin/ai/teams/${teamId}`, "PATCH", { enabled: !enabled })}
      >
        {enabled ? "Ligada" : "Desligada"}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
