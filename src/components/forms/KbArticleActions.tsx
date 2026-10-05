"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/client-api";

/** Publicar ou despublicar e apagar (com confirmação) um artigo, para quem gerencia a base. */
export function KbArticleActions({ id, published }: { id: string; published: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setError(null);
    setPending(true);
    const result = await sendJson(`/api/kb/${id}`, "PATCH", { published: !published });
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Apagar este artigo? Isso não pode ser desfeito.")) return;
    setError(null);
    setPending(true);
    const result = await sendJson(`/api/kb/${id}`, "DELETE");
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    router.push("/kb");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={toggle}>
        {published ? "Despublicar" : "Publicar"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={remove}>
        Apagar
      </Button>
      {error && (
        <span role="alert" className="text-sm text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
