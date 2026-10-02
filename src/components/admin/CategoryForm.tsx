"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "./useAction";

type Team = { id: string; name: string };

export function CategoryDefaultTeam({ id, defaultTeamId, teams }: { id: string; defaultTeamId: string | null; teams: Team[] }) {
  const { run, error, pending } = useAction();
  return (
    <span className="flex items-center gap-2">
      <select
        aria-label="Equipe padrão"
        defaultValue={defaultTeamId ?? ""}
        disabled={pending}
        onChange={(e) => run(`/api/admin/categories/${id}`, "PATCH", { defaultTeamId: e.target.value || null })}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
      >
        <option value="">Sem equipe padrão</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

export function CreateCategoryForm({ teams }: { teams: Team[] }) {
  const { run, error, pending } = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const defaultTeamId = String(data.get("defaultTeamId") ?? "");
    const ok = await run("/api/admin/categories", "POST", {
      name: String(data.get("name") ?? ""),
      ...(defaultTeamId ? { defaultTeamId } : {}),
    });
    if (ok) form.reset();
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Nova categoria" aria-label="Nome da nova categoria" required className="w-56" />
      <select
        name="defaultTeamId"
        aria-label="Equipe padrão da nova categoria"
        defaultValue=""
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
      >
        <option value="">Sem equipe padrão</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending}>
        Criar categoria
      </Button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </form>
  );
}
