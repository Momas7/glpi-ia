import { TZDate } from "@date-fns/tz";

export type Period = "this_month" | "last_month" | "last_30_days" | "last_90_days";
export const PERIODS: Period[] = ["this_month", "last_month", "last_30_days", "last_90_days"];

export const PERIOD_LABEL: Record<Period, string> = {
  this_month: "Este mês",
  last_month: "Mês passado",
  last_30_days: "Últimos 30 dias",
  last_90_days: "Últimos 90 dias",
};

/** Instante da meia-noite local do dia (y, m0, d), com `d` podendo estourar o mês (o fuso resolve). */
const localMidnight = (y: number, m0: number, d: number, tz: string) => new Date(new TZDate(y, m0, d, 0, 0, 0, 0, tz).getTime());

/** Intervalo `[from, to)` no fuso da empresa. */
export function periodRange(period: Period, now: Date, timeZone: string): { from: Date; to: Date } {
  const z = new TZDate(now.getTime(), timeZone);
  const y = z.getFullYear();
  const m = z.getMonth();
  const d = z.getDate();
  switch (period) {
    case "this_month":
      return { from: localMidnight(y, m, 1, timeZone), to: localMidnight(y, m + 1, 1, timeZone) };
    case "last_month":
      return { from: localMidnight(y, m - 1, 1, timeZone), to: localMidnight(y, m, 1, timeZone) };
    case "last_30_days":
      return { from: localMidnight(y, m, d + 1 - 30, timeZone), to: localMidnight(y, m, d + 1, timeZone) };
    case "last_90_days":
      return { from: localMidnight(y, m, d + 1 - 90, timeZone), to: localMidnight(y, m, d + 1, timeZone) };
  }
}

/** Inícios dos últimos `months` meses locais, do mais antigo ao atual. */
export function monthStarts(now: Date, timeZone: string, months: number): Date[] {
  const z = new TZDate(now.getTime(), timeZone);
  return Array.from({ length: months }, (_, i) => localMidnight(z.getFullYear(), z.getMonth() - (months - 1 - i), 1, timeZone));
}
