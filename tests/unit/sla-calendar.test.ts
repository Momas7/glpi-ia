import { TZDate } from "@date-fns/tz";
import { beforeAll, describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from "@/modules/sla/calendar";

beforeAll(() => {
  process.env.TZ = "UTC"; // o servidor pode estar em UTC: as contas não podem depender do fuso da máquina
});

const SP = "America/Sao_Paulo";
const sp = (y: number, m: number, d: number, h = 0, min = 0) => new Date(new TZDate(y, m - 1, d, h, min, SP).getTime());
const weekdays = (start = 480, end = 1080) => new Map([1, 2, 3, 4, 5].map((w) => [w, { start, end }]));
const cal: BusinessCalendar = { timeZone: SP, hours: weekdays(), holidays: new Set(["2026-04-03"]) };

describe("addBusinessMinutes", () => {
  it("sexta 17h30 + 60 min = segunda 8h30", () => {
    expect(addBusinessMinutes(sp(2026, 10, 2, 17, 30), 60, cal)).toEqual(sp(2026, 10, 5, 8, 30));
  });

  it("sábado 10h + 30 min = segunda 8h30", () => {
    expect(addBusinessMinutes(sp(2026, 10, 3, 10), 30, cal)).toEqual(sp(2026, 10, 5, 8, 30));
  });

  it("pula feriado: quinta 02/04/2026 17h + 120 min = segunda 06/04 9h", () => {
    expect(addBusinessMinutes(sp(2026, 4, 2, 17), 120, cal)).toEqual(sp(2026, 4, 6, 9));
  });

  it("zero minutos: dentro do expediente fica onde está; antes do expediente vai para o início", () => {
    expect(addBusinessMinutes(sp(2026, 10, 6, 10), 0, cal)).toEqual(sp(2026, 10, 6, 10));
    expect(addBusinessMinutes(sp(2026, 10, 6, 7), 0, cal)).toEqual(sp(2026, 10, 6, 8));
  });

  it("sexta 17h50 locais + 60 = segunda 8h50 locais, com o processo em UTC", () => {
    expect(process.env.TZ).toBe("UTC");
    expect(addBusinessMinutes(sp(2026, 10, 2, 17, 50), 60, cal)).toEqual(sp(2026, 10, 5, 8, 50));
  });

  it("calendário sem expediente lança em vez de entrar em laço", () => {
    expect(() => addBusinessMinutes(sp(2026, 10, 6, 10), 60, { timeZone: SP, hours: new Map(), holidays: new Set() })).toThrow(
      "Calendário sem expediente",
    );
  });

  it("respeita a mudança de horário de verão (America/New_York, 08/03/2026)", () => {
    const NY = "America/New_York";
    const ny = (d: number, h: number) => new Date(new TZDate(2026, 2, d, h, 0, NY).getTime());
    const nyCal: BusinessCalendar = { timeZone: NY, hours: weekdays(), holidays: new Set() };
    // sexta 06/03 17h + 120 min úteis = segunda 09/03 9h (horário de parede), mesmo com o relógio adiantado no domingo
    expect(addBusinessMinutes(ny(6, 17), 120, nyCal)).toEqual(ny(9, 9));
  });
});

describe("businessMinutesBetween", () => {
  it("conta só o expediente", () => {
    expect(businessMinutesBetween(sp(2026, 10, 2, 17), sp(2026, 10, 5, 9), cal)).toBe(120);
    expect(businessMinutesBetween(sp(2026, 10, 5, 9), sp(2026, 10, 5, 9), cal)).toBe(0);
    expect(businessMinutesBetween(sp(2026, 10, 5, 9), sp(2026, 10, 2, 17), cal)).toBe(0);
  });

  it("ida e volta: between(s, add(s, n)) = n", () => {
    const start = sp(2026, 10, 6, 9, 15);
    for (let i = 1; i <= 50; i++) {
      const n = Math.round((i * 4999) / 50) + 1;
      expect(businessMinutesBetween(start, addBusinessMinutes(start, n, cal), cal), `n=${n}`).toBe(n);
    }
  });
});
