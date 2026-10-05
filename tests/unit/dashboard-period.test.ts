import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import { monthStarts, periodRange } from "@/modules/dashboard/period";

process.env.TZ = "UTC"; // o servidor pode estar em UTC: as contas usam o fuso da empresa
const SP = "America/Sao_Paulo";
const sp = (y: number, m: number, d: number, h = 0, min = 0) => new Date(new TZDate(y, m - 1, d, h, min, SP).getTime());

describe("periodRange", () => {
  it("this_month: do dia 1 às 00:00 locais ao dia 1 do mês seguinte", () => {
    expect(periodRange("this_month", sp(2026, 10, 15, 14), SP)).toEqual({ from: sp(2026, 10, 1), to: sp(2026, 11, 1) });
  });

  it("last_month: o mês anterior inteiro (fevereiro de 28 dias)", () => {
    const r = periodRange("last_month", sp(2026, 3, 2, 10), SP);
    expect(r).toEqual({ from: sp(2026, 2, 1), to: sp(2026, 3, 1) });
    expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBe(28);
  });

  it("last_30_days e last_90_days terminam no início do dia seguinte ao de hoje", () => {
    expect(periodRange("last_30_days", sp(2026, 10, 15, 23, 59), SP)).toEqual({ from: sp(2026, 9, 16), to: sp(2026, 10, 16) });
    expect(periodRange("last_90_days", sp(2026, 10, 15, 8), SP)).toEqual({ from: sp(2026, 7, 18), to: sp(2026, 10, 16) });
  });

  it("23h30 do último dia do mês (horário de São Paulo, já dia seguinte em UTC) pertence ao mês certo", () => {
    const lateOct31 = sp(2026, 10, 31, 23, 30);
    expect(lateOct31.toISOString().startsWith("2026-11-01")).toBe(true); // em UTC já é novembro
    const oct = periodRange("this_month", sp(2026, 10, 20), SP);
    const nov = periodRange("this_month", sp(2026, 11, 20), SP);
    expect(lateOct31 >= oct.from && lateOct31 < oct.to).toBe(true);
    expect(lateOct31 >= nov.from && lateOct31 < nov.to).toBe(false);
  });
});

describe("monthStarts", () => {
  it("devolve os inícios dos últimos N meses locais, do mais antigo ao atual", () => {
    expect(monthStarts(sp(2026, 2, 10), SP, 4)).toEqual([sp(2025, 11, 1), sp(2025, 12, 1), sp(2026, 1, 1), sp(2026, 2, 1)]);
  });
});
