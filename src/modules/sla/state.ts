import { businessMinutesBetween, type BusinessCalendar } from "./calendar";

export type SlaStateName = "none" | "ok" | "at_risk" | "breached" | "paused" | "done";

export interface SlaTicketFields {
  status: string;
  createdAt: Date;
  resolutionDue: Date | null;
  slaResolutionMinutes: number | null;
  pausedAt: Date | null;
  pausedMinutes: number;
}

const AT_RISK_RATIO = 0.8;

/** Estado do prazo de resolução. `remainingMinutes` em minutos úteis (negativo quando vencido). */
export function slaState(
  t: SlaTicketFields,
  now: Date,
  cal: BusinessCalendar,
): { state: SlaStateName; remainingMinutes: number | null } {
  if (!t.resolutionDue || !t.slaResolutionMinutes) return { state: "none", remainingMinutes: null };
  if (t.status === "RESOLVED" || t.status === "CLOSED") return { state: "done", remainingMinutes: null };
  if (t.pausedAt) return { state: "paused", remainingMinutes: null };
  if (now.getTime() > t.resolutionDue.getTime()) {
    return { state: "breached", remainingMinutes: -businessMinutesBetween(t.resolutionDue, now, cal) };
  }
  const consumed = businessMinutesBetween(t.createdAt, now, cal) - t.pausedMinutes;
  const remainingMinutes = businessMinutesBetween(now, t.resolutionDue, cal);
  return { state: consumed >= AT_RISK_RATIO * t.slaResolutionMinutes ? "at_risk" : "ok", remainingMinutes };
}

const BUSINESS_DAY_MINUTES = 600; // só para exibir: 1 dia útil = 10 h

/** "45 min", "1 h 30 min", "1 dia útil e 2 h", "2 dias úteis" (usa o valor absoluto). */
export function formatBusinessDuration(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  const hm = (x: number) => {
    const h = Math.floor(x / 60);
    const rest = x % 60;
    if (h === 0) return `${rest} min`;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  };
  if (m < BUSINESS_DAY_MINUTES) return hm(m);
  const days = Math.floor(m / BUSINESS_DAY_MINUTES);
  const rest = m % BUSINESS_DAY_MINUTES;
  const dayText = days === 1 ? "1 dia útil" : `${days} dias úteis`;
  return rest ? `${dayText} e ${hm(rest)}` : dayText;
}
