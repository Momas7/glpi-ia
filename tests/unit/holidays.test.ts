import { describe, expect, it } from "vitest";
import { easterSunday, nationalHolidays } from "@/modules/sla/holidays";

describe("feriados nacionais", () => {
  it("Páscoa", () => {
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
  });

  it("feriados móveis a partir da Páscoa", () => {
    const dates = (y: number) => nationalHolidays(y).map((h) => h.date);
    expect(dates(2025)).toEqual(expect.arrayContaining(["2025-03-03", "2025-03-04", "2025-06-19"]));
    expect(dates(2026)).toEqual(expect.arrayContaining(["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04"]));
    expect(dates(2027)).toEqual(expect.arrayContaining(["2027-02-08", "2027-02-09", "2027-05-27"]));
  });

  it("2026 tem 13 feriados, inclui a Consciência Negra e não repete datas", () => {
    const list = nationalHolidays(2026);
    expect(list).toHaveLength(13);
    expect(list.map((h) => h.date)).toContain("2026-11-20");
    expect(new Set(list.map((h) => h.date)).size).toBe(13);
    expect(list.every((h) => h.name.length > 0)).toBe(true);
  });
});
