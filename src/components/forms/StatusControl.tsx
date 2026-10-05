"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SolutionBox } from "@/components/SolutionBox";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/client-api";
import { STATUS_LABEL } from "@/lib/labels";

export function StatusControl({ ticketId, next }: { ticketId: string; next: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [solving, setSolving] = useState(false);
  if (next.length === 0) return null;

  async function change(status: string, resolution?: string) {
    setError(null);
    setPending(true);
    const result = await sendJson(`/api/tickets/${ticketId}`, "PATCH", resolution === undefined ? { status } : { status, resolution });
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    setSolving(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {next.map((s) => (
          <Button
            key={s}
            size="sm"
            variant="outline"
            disabled={pending}
            // Resolver pede a solução antes de enviar.
            onClick={() => (s === "RESOLVED" ? setSolving(true) : change(s))}
          >
            Marcar como {STATUS_LABEL[s].toLowerCase()}
          </Button>
        ))}
        {error && (
          <span role="alert" className="text-sm text-red-400">
            {error}
          </span>
        )}
      </div>
      {solving && <SolutionBox pending={pending} onSubmit={(solution) => change("RESOLVED", solution)} onCancel={() => setSolving(false)} />}
    </div>
  );
}
