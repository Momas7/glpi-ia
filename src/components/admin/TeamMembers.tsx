"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "./useAction";

type Person = { id: string; name: string; email: string };

export function TeamMembers({
  team,
  staff,
}: {
  team: { id: string; name: string; members: Person[] };
  staff: Person[];
}) {
  const { run, error, pending } = useAction();
  const [renaming, setRenaming] = useState(false);
  const candidates = staff.filter((s) => !team.members.some((m) => m.id === s.id));

  async function onRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    if (await run(`/api/admin/teams/${team.id}`, "PATCH", { name })) setRenaming(false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-white/10 p-4">
      <header className="flex items-center justify-between gap-2">
        {renaming ? (
          <form onSubmit={onRename} className="flex gap-2">
            <Input name="name" defaultValue={team.name} aria-label="Nome da equipe" className="h-8 w-56" />
            <Button size="sm" type="submit" disabled={pending}>
              Salvar
            </Button>
          </form>
        ) : (
          <h3 className="font-medium">{team.name}</h3>
        )}
        <Button size="sm" variant="ghost" onClick={() => setRenaming((v) => !v)}>
          {renaming ? "Cancelar" : "Renomear"}
        </Button>
      </header>

      <ul className="flex flex-col gap-1 text-sm">
        {team.members.length === 0 && <li className="text-muted-foreground">Sem membros.</li>}
        {team.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2">
            <span>
              {m.name} <span className="text-muted-foreground">({m.email})</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(`/api/admin/teams/${team.id}/members/${m.id}`, "DELETE")}
            >
              Remover
            </Button>
          </li>
        ))}
      </ul>

      {candidates.length > 0 && (
        <select
          aria-label={`Adicionar membro em ${team.name}`}
          defaultValue=""
          disabled={pending}
          onChange={(e) => e.target.value && run(`/api/admin/teams/${team.id}/members`, "POST", { userId: e.target.value })}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Adicionar membro…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

export function CreateTeamForm() {
  const { run, error, pending } = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (await run("/api/admin/teams", "POST", { name: String(new FormData(form).get("name") ?? "") })) form.reset();
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Nome da nova equipe" aria-label="Nome da nova equipe" required className="w-64" />
      <Button type="submit" disabled={pending}>
        Criar equipe
      </Button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </form>
  );
}
