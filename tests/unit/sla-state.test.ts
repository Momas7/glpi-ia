import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import type { BusinessCalendar } from "@/modules/sla/calendar";
import { formatBusinessDuration, slaState } from "@/modules/sla/state";

const SP = "America/Sao_Paulo";
const sp = (d: number, h: number, min = 0) => new Date(new TZDate(2026, 9, d, h, min, SP).getTime()); // outubro/2026
const cal: BusinessCalendar = { timeZone: SP, hours: new Map([1, 2, 3, 4, 5].map((w) => [w, { start: 480, end: 1080 }])), holidays: new Set() };

// Criado segunda 05/10 8h, resolução em 100 min úteis → vence 9h40
const base = { status: "OPEN", createdAt: sp(5, 8), resolutionDue: sp(5, 9, 40), slaResolutionMinutes: 100, pausedAt: null, pausedMinutes: 0 };

describe("slaState", () => {
  it("sem prazo → none; resolvido ou fechado → done; pausado → paused", () => {
    expect(slaState({ ...base, resolutionDue: null, slaResolutionMinutes: null }, sp(5, 9), cal).state).toBe("none");
    expect(slaState({ ...base, status: "RESOLVED" }, sp(5, 9), cal).state).toBe("done");
    expect(slaState({ ...base, status: "CLOSED" }, sp(5, 12), cal).state).toBe("done");
    expect(slaState({ ...base, status: "PENDING", pausedAt: sp(5, 8, 30) }, sp(5, 12), cal)).toEqual({ state: "paused", remainingMinutes: null });
  });

  it("ok abaixo de 80%; at_risk a partir de exatamente 80% consumido", () => {
    expect(slaState(base, sp(5, 9, 19), cal)).toEqual({ state: "ok", remainingMinutes: 21 });
    expect(slaState(base, sp(5, 9, 20), cal)).toEqual({ state: "at_risk", remainingMinutes: 20 });
  });

  it("pausas já encerradas descontam do consumido", () => {
    // 80 min passados, mas 30 deles pausados → 50% consumido
    expect(slaState({ ...base, pausedMinutes: 30, resolutionDue: sp(5, 10, 10) }, sp(5, 9, 20), cal).state).toBe("ok");
  });

  it("vencido → breached com minutos úteis excedidos negativos", () => {
    expect(slaState(base, sp(5, 10, 40), cal)).toEqual({ state: "breached", remainingMinutes: -60 });
  });
});

describe("formatBusinessDuration", () => {
  it.each([
    [45, "45 min"],
    [120, "2 h"],
    [90, "1 h 30 min"],
    [600, "1 dia útil"],
    [720, "1 dia útil e 2 h"],
    [1200, "2 dias úteis"],
    [-60, "1 h"],
  ])("%i → %s", (m, text) => {
    expect(formatBusinessDuration(m)).toBe(text);
  });
});
