"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/useAction";
import { PRIORITY_LABEL } from "@/lib/labels";

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const toHours = (min: number) => String(Math.round((min / 60) * 100) / 100);
const toMinutes = (hours: string) => Math.round(Number(hours.replace(",", ".")) * 60);
const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fromTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function PoliciesForm({ policies }: { policies: { priority: string; firstResponseMinutes: number; resolutionMinutes: number }[] }) {
  const { run, error, pending } = useAction();
  const [saved, setSaved] = useState(false);
  const byPriority = new Map(policies.map((p) => [p.priority, p]));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const data = new FormData(e.currentTarget);
    const body = {
      policies: PRIORITIES.map((priority) => ({
        priority,
        firstResponseMinutes: toMinutes(String(data.get(`fr-${priority}`))),
        resolutionMinutes: toMinutes(String(data.get(`res-${priority}`))),
      })),
    };
    if (await run("/api/admin/sla/policies", "PUT", body)) setSaved(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <table className="w-full max-w-xl text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1">Prioridade</th>
            <th>1ª resposta (h úteis)</th>
            <th>Resolução (h úteis)</th>
          </tr>
        </thead>
        <tbody>
          {PRIORITIES.map((p) => (
            <tr key={p}>
              <td className="py-1">{PRIORITY_LABEL[p]}</td>
              <td>
                <Input
                  name={`fr-${p}`}
                  aria-label={`1ª resposta (h úteis) — ${PRIORITY_LABEL[p]}`}
                  defaultValue={toHours(byPriority.get(p)?.firstResponseMinutes ?? 240)}
                  inputMode="decimal"
                  className="h-8 w-24"
                />
              </td>
              <td>
                <Input
                  name={`res-${p}`}
                  aria-label={`Resolução (h úteis) — ${PRIORITY_LABEL[p]}`}
                  defaultValue={toHours(byPriority.get(p)?.resolutionMinutes ?? 1440)}
                  inputMode="decimal"
                  className="h-8 w-24"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Salvar prazos
        </Button>
        {saved && <span className="text-sm text-emerald-400">Prazos salvos.</span>}
        {error && (
          <span role="alert" className="text-sm text-red-400">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

export function BusinessHoursForm({ hours }: { hours: { weekday: number; startMinute: number; endMinute: number }[] }) {
  const { run, error, pending } = useAction();
  const [saved, setSaved] = useState(false);
  const byDay = new Map(hours.map((h) => [h.weekday, h]));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const data = new FormData(e.currentTarget);
    const days = WEEKDAYS.flatMap((_, weekday) =>
      data.get(`on-${weekday}`)
        ? [{ weekday, startMinute: fromTime(String(data.get(`start-${weekday}`))), endMinute: fromTime(String(data.get(`end-${weekday}`))) }]
        : [],
    );
    if (await run("/api/admin/sla/hours", "PUT", { days })) setSaved(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 text-sm">
      {WEEKDAYS.map((label, weekday) => {
        const h = byDay.get(weekday);
        return (
          <div key={weekday} className="flex items-center gap-3">
            <label className="flex w-28 items-center gap-2">
              <input type="checkbox" name={`on-${weekday}`} defaultChecked={!!h} /> {label}
            </label>
            <Input type="time" name={`start-${weekday}`} aria-label={`Início — ${label}`} defaultValue={toTime(h?.startMinute ?? 480)} className="h-8 w-28" />
            <span className="text-muted-foreground">até</span>
            <Input type="time" name={`end-${weekday}`} aria-label={`Fim — ${label}`} defaultValue={toTime(h?.endMinute ?? 1080)} className="h-8 w-28" />
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="self-start">
          Salvar expediente
        </Button>
        {saved && <span className="text-emerald-400">Expediente salvo.</span>}
        {error && (
          <span role="alert" className="text-red-400">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

export function HolidayForm() {
  const { run, error, pending } = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const ok = await run("/api/admin/sla/holidays", "POST", { date: String(data.get("date")), name: String(data.get("name")) });
    if (ok) form.reset();
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 text-sm">
      <Input type="date" name="date" required aria-label="Data do feriado" className="h-8 w-40" />
      <Input name="name" required placeholder="Nome do feriado" aria-label="Nome do feriado" className="h-8 w-56" />
      <Button type="submit" size="sm" disabled={pending}>
        Adicionar feriado
      </Button>
      {error && <span className="text-red-400">{error}</span>}
    </form>
  );
}

export function RemoveHolidayButton({ id, label }: { id: string; label: string }) {
  const { run, pending } = useAction();
  return (
    <Button size="sm" variant="ghost" aria-label={`Remover ${label}`} disabled={pending} onClick={() => run(`/api/admin/sla/holidays/${id}`, "DELETE")}>
      Remover
    </Button>
  );
}
