"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, sendJson } from "@/lib/client-api";

function fillPlaceholders(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{([\w.]+)\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], data);
    return encodeURIComponent(String(value ?? ""));
  });
}

export interface Field {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "textarea" | "select";
  options?: { value: string; label: string }[];
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}

/** Formulário genérico: envia JSON a uma rota /api e redireciona (ou mostra mensagem) no sucesso. */
export function JsonForm({
  endpoint,
  method = "POST",
  fields,
  submitLabel,
  hidden = {},
  redirectTo,
  successMessage,
}: {
  endpoint: string;
  method?: "POST" | "PATCH";
  fields: Field[];
  submitLabel: string;
  hidden?: Record<string, string>;
  /** Caminho de destino; aceita placeholders da resposta, ex.: "/tickets/{ticket.id}". */
  redirectTo?: string;
  successMessage?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...hidden };
    for (const f of fields) {
      const v = String(form.get(f.name) ?? "");
      if (v !== "") body[f.name] = v;
    }
    const result = await sendJson(endpoint, method, body);
    setPending(false);
    if (!result.ok) return setError(errorMessage(result));
    if (redirectTo) {
      router.push(fillPlaceholders(redirectTo, result.data));
      router.refresh();
    } else {
      setDone(successMessage ?? "Pronto.");
    }
  }

  if (done) return <p className="text-sm text-emerald-400">{done}</p>;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
      {fields.map((f) => (
        <div key={f.name} className="flex flex-col gap-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>
          {f.type === "textarea" ? (
            <Textarea id={f.name} name={f.name} required={f.required ?? true} rows={6} />
          ) : f.type === "select" ? (
            <select
              id={f.name}
              name={f.name}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              defaultValue=""
            >
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              required={f.required ?? true}
            />
          )}
          {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Enviando…" : submitLabel}
      </Button>
    </form>
  );
}
