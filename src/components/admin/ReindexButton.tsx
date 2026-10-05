"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/client-api";

/** Pede a reindexação de tudo. Necessário depois de trocar o modelo de embedding ou de ligar a IA. */
export function ReindexButton() {
  const [state, setState] = useState<"idle" | "pending" | "queued">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm("Reindexar toda a base de conhecimento? Isso consome a cota de embeddings do provider.")) return;
    setError(null);
    setState("pending");
    const result = await sendJson("/api/admin/ai/reindex", "POST");
    if (!result.ok) {
      setState("idle");
      return setError(errorMessage(result));
    }
    setState("queued");
  }

  return (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="outline" disabled={state === "pending"} onClick={onClick}>
        Reindexar tudo
      </Button>
      {state === "queued" && <span role="status" className="text-sm text-muted-foreground">Reindexação enfileirada. O worker processa em lotes.</span>}
      {error && (
        <span role="alert" className="text-sm text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
