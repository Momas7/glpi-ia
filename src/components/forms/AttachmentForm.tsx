"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AttachmentForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/attachments`, { method: "POST", body: new FormData(form) });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setError(data.error ?? "Não foi possível enviar o arquivo.");
    }
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input type="file" name="file" required className="max-w-xs" aria-label="Arquivo" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Enviando…" : "Anexar"}
      </Button>
      <span className="text-xs text-muted-foreground">png, jpg, jpeg, pdf, txt, log, docx, xlsx · até 10 MB</span>
      {error && (
        <p role="alert" className="w-full text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
