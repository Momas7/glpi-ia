/** Domingo de Páscoa (calendário gregoriano), algoritmo de Meeus/Jones/Butcher. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

const FIXED: [string, string][] = [
  ["01-01", "Confraternização Universal"],
  ["04-21", "Tiradentes"],
  ["05-01", "Dia do Trabalho"],
  ["09-07", "Independência do Brasil"],
  ["10-12", "Nossa Senhora Aparecida"],
  ["11-02", "Finados"],
  ["11-15", "Proclamação da República"],
  ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"],
  ["12-25", "Natal"],
];

/** Feriados nacionais (fixos e móveis) de um ano, em datas `YYYY-MM-DD`, ordenados. */
export function nationalHolidays(year: number): { date: string; name: string }[] {
  const { month, day } = easterSunday(year);
  const easter = Date.UTC(year, month - 1, day);
  const fromEaster = (offset: number, name: string) => ({ date: iso(new Date(easter + offset * 86_400_000)), name });
  return [
    ...FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    fromEaster(-48, "Carnaval (segunda-feira)"),
    fromEaster(-47, "Carnaval (terça-feira)"),
    fromEaster(-2, "Sexta-feira Santa"),
    fromEaster(60, "Corpus Christi"),
  ].sort((x, y) => x.date.localeCompare(y.date));
}
