"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL } from "@/lib/labels";
import { useAction } from "@/components/useAction";

export function InviteForm() {
  const { run, error, pending } = useAction();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setCopied(false);
    const res = await run<{ inviteUrl: string }>("/api/auth/invite", "POST", {
      email: String(data.get("email") ?? ""),
      role: String(data.get("role") ?? "REQUESTER"),
    });
    if (res) {
      setLink(res.inviteUrl);
      form.reset();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">E-mail</Label>
          <Input id="invite-email" name="email" type="email" required className="w-72" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Papel</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="REQUESTER"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Gerando…" : "Convidar"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {link && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 p-3 text-sm">
          <span className="text-muted-foreground">Link do convite (vale 72 h, uso único):</span>
          <code className="max-w-full break-all" data-testid="invite-link">
            {link}
          </code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
      )}
    </div>
  );
}
