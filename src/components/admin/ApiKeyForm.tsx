"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/useAction";

const SCOPE_LABEL: Record<string, string> = {
  "tickets:create": "Abrir chamados",
  "comments:create": "Comentar em chamados",
};

export function ApiKeyForm() {
  const { run, error, pending } = useAction();
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setCopied(false);
    const res = await run<{ key: string }>("/api/admin/api-keys", "POST", {
      name: String(data.get("name") ?? ""),
      scopes: data.getAll("scopes").map(String),
    });
    if (res) {
      setCreated(res.key);
      form.reset();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key-name">Nome da chave</Label>
          <Input id="key-name" name="name" required placeholder="ex.: n8n e-mail" className="w-56" />
        </div>
        <fieldset className="flex gap-3 text-sm">
          <legend className="sr-only">Permissões</legend>
          {Object.entries(SCOPE_LABEL).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="checkbox" name="scopes" value={value} defaultChecked /> {label}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={pending}>
          Criar chave
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {created && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <span>Copie agora: a chave não será mostrada de novo.</span>
          <code className="break-all" data-testid="api-key-secret">
            {created}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(created);
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

export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  const { run, error, pending } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="outline" aria-label={`Revogar ${name}`} disabled={pending} onClick={() => run(`/api/admin/api-keys/${id}`, "DELETE")}>
        Revogar
      </Button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function RetryDeliveryButton({ id }: { id: string }) {
  const { run, error, pending } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/admin/webhooks/${id}/retry`, "POST")}>
        Reenviar
      </Button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
