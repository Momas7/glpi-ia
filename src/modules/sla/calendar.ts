import { TZDate } from "@date-fns/tz";

/** Expediente por dia da semana (0 = domingo) em minutos do dia, feriados em `YYYY-MM-DD`, tudo no `timeZone`. */
export interface BusinessCalendar {
  timeZone: string;
  hours: Map<number, { start: number; end: number }>;
  holidays: Set<string>;
}

const MS_PER_MINUTE = 60_000;
// Sem nenhum dia útil num ano inteiro, o calendário está errado: falha em vez de procurar para sempre.
const MAX_DAYS_WITHOUT_WORK = 366;

const pad = (n: number) => String(n).padStart(2, "0");

interface LocalDay {
  y: number;
  m: number; // 0–11
  d: number;
  weekday: number;
  minuteOfDay: number; // pode ter fração (segundos)
}

function toLocal(date: Date, tz: string): LocalDay {
  const z = new TZDate(date.getTime(), tz);
  return {
    y: z.getFullYear(),
    m: z.getMonth(),
    d: z.getDate(),
    weekday: z.getDay(),
    minuteOfDay: z.getHours() * 60 + z.getMinutes() + z.getSeconds() / 60 + z.getMilliseconds() / 60_000,
  };
}

/** Instante do relógio de parede (y, m, d, minuto do dia) no fuso — correto também em dias de horário de verão. */
function wallClock(y: number, m: number, d: number, minuteOfDay: number, tz: string): Date {
  const h = Math.floor(minuteOfDay / 60);
  const min = Math.floor(minuteOfDay % 60);
  const ms = Math.round((minuteOfDay - Math.floor(minuteOfDay)) * 60_000);
  return new Date(new TZDate(y, m, d, h, min, 0, ms, tz).getTime());
}

function windowFor(day: LocalDay, cal: BusinessCalendar): { start: number; end: number } | null {
  if (cal.holidays.has(`${day.y}-${pad(day.m + 1)}-${pad(day.d)}`)) return null;
  const w = cal.hours.get(day.weekday);
  return w && w.end > w.start ? w : null;
}

function nextDay(day: LocalDay, tz: string): LocalDay {
  return toLocal(wallClock(day.y, day.m, day.d + 1, 0, tz), tz);
}

function assertHasWork(cal: BusinessCalendar) {
  if (![...cal.hours.values()].some((w) => w.end > w.start)) throw new Error("Calendário sem expediente");
}

/** Soma minutos úteis a partir de `start`. Fora do expediente, a contagem começa no próximo intervalo útil. */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  assertHasWork(cal);
  let day = toLocal(start, cal.timeZone);
  let remaining = minutes;
  let idle = 0;
  for (;;) {
    const w = windowFor(day, cal);
    if (w && day.minuteOfDay < w.end) {
      const from = Math.max(day.minuteOfDay, w.start);
      const available = w.end - from;
      if (remaining <= available) return wallClock(day.y, day.m, day.d, from + remaining, cal.timeZone);
      remaining -= available;
      idle = 0;
    } else if (++idle > MAX_DAYS_WITHOUT_WORK) {
      throw new Error("Calendário sem expediente");
    }
    day = nextDay(day, cal.timeZone);
  }
}

/** Minutos úteis entre `a` e `b` (0 se `b <= a`). */
export function businessMinutesBetween(a: Date, b: Date, cal: BusinessCalendar): number {
  if (b.getTime() <= a.getTime()) return 0;
  const last = toLocal(b, cal.timeZone);
  let day = toLocal(a, cal.timeZone);
  let total = 0;
  for (;;) {
    const w = windowFor(day, cal);
    if (w) {
      const wStart = wallClock(day.y, day.m, day.d, w.start, cal.timeZone).getTime();
      const wEnd = wallClock(day.y, day.m, day.d, w.end, cal.timeZone).getTime();
      const overlap = Math.min(b.getTime(), wEnd) - Math.max(a.getTime(), wStart);
      if (overlap > 0) total += overlap;
    }
    if (day.y === last.y && day.m === last.m && day.d === last.d) break;
    day = nextDay(day, cal.timeZone);
  }
  return Math.round(total / MS_PER_MINUTE);
}
