"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, sendJson } from "@/lib/client-api";

export function CommentForm({ ticketId, canInternal }: { ticketId: string; canInternal: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    const result = await sendJson(`/api/tickets/${ticketId}/comments`, "POST", {
      body: String(data.get("body") ?? ""),
      internal: data.get("internal") === "on",
    });
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Label htmlFor="body">Adicionar comentário</Label>
      <Textarea id="body" name="body" required rows={4} />
      {canInternal && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="internal" /> Nota interna (não visível ao solicitante)
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Enviando…" : "Comentar"}
      </Button>
    </form>
  );
}
