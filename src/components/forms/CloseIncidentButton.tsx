"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/client-api";

/** Encerra o incidente à mão (líder da equipe afetada ou admin). */
export function CloseIncidentButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm("Encerrar este incidente? Os chamados continuam abertos, só o agrupamento é encerrado.")) return;
    setError(null);
    setPending(true);
    const result = await sendJson(`/api/incidents/${id}/close`, "POST");
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={onClick}>
        Encerrar incidente
      </Button>
      {error && (
        <span role="alert" className="text-sm text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
