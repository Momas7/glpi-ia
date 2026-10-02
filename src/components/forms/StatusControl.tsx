"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/client-api";
import { STATUS_LABEL } from "@/lib/labels";

export function StatusControl({ ticketId, next }: { ticketId: string; next: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (next.length === 0) return null;

  async function change(status: string) {
    setError(null);
    const result = await sendJson(`/api/tickets/${ticketId}`, "PATCH", { status });
    if (!result.ok) return setError(errorMessage(result));
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {next.map((s) => (
        <Button key={s} size="sm" variant="outline" onClick={() => change(s)}>
          Marcar como {STATUS_LABEL[s].toLowerCase()}
        </Button>
      ))}
      {error && (
        <span role="alert" className="text-sm text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
