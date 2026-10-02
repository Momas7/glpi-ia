import { z } from "zod";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit";
// Imports diretos (não pelo index de auth) evitam ciclo de módulos.
import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";
import { invalidateCalendarCache } from "./service";

const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const policiesSchema = z
  .array(
    z
      .object({
        priority: priorityEnum,
        firstResponseMinutes: z.number().int().min(1).max(100_000),
        resolutionMinutes: z.number().int().min(1).max(100_000),
      })
      .refine((p) => p.firstResponseMinutes <= p.resolutionMinutes, "A 1ª resposta não pode passar do prazo de resolução."),
  )
  .min(1);

export const businessHoursSchema = z
  .array(
    z
      .object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0), endMinute: z.number().int().max(1440) })
      .refine((d) => d.startMinute < d.endMinute, "O fim do expediente precisa ser depois do início."),
  )
  .min(1, "É preciso pelo menos um dia de expediente.")
  .refine((days) => new Set(days.map((d) => d.weekday)).size === days.length, "Dia da semana repetido.");

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD."),
  name: z.string().trim().min(2).max(120),
});

function assertAdmin(actor: SessionUser) {
  if (!can(actor, "admin:manage")) throw new ForbiddenError();
}

/** Valida e converte erros de validação em 400 (as funções também são chamadas fora das rotas). */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, result.error.issues.map((i) => i.message).join(" "));
  return result.data;
}

/** Mudanças valem para chamados abertos a partir de agora (os já abertos guardam os minutos da época). */
export async function updatePolicies(actor: SessionUser, input: z.input<typeof policiesSchema>): Promise<void> {
  assertAdmin(actor);
  const policies = parse(policiesSchema, input);
  await getDb().$transaction(async (tx) => {
    for (const p of policies) {
      await tx.slaPolicy.upsert({ where: { priority: p.priority }, update: p, create: p });
    }
    await recordAudit(tx, { actorId: actor.id, action: "sla.policy_update", targetType: "sla", targetId: "policies", data: { policies } });
  });
}

export async function updateBusinessHours(actor: SessionUser, input: z.input<typeof businessHoursSchema>): Promise<void> {
  assertAdmin(actor);
  const days = parse(businessHoursSchema, input);
  await getDb().$transaction(async (tx) => {
    await tx.businessHours.deleteMany();
    await tx.businessHours.createMany({ data: days });
    await recordAudit(tx, { actorId: actor.id, action: "sla.hours_update", targetType: "sla", targetId: "hours", data: { days } });
  });
  invalidateCalendarCache();
}

export async function addHoliday(actor: SessionUser, input: z.input<typeof holidaySchema>) {
  assertAdmin(actor);
  const { date, name } = parse(holidaySchema, input);
  try {
    const holiday = await getDb().$transaction(async (tx) => {
      const h = await tx.holiday.create({ data: { date: new Date(`${date}T00:00:00Z`), name } });
      await recordAudit(tx, { actorId: actor.id, action: "holiday.create", targetType: "sla", targetId: h.id, data: { date, name } });
      return h;
    });
    invalidateCalendarCache();
    return holiday;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") throw new AppError(409, "Já existe um feriado nessa data.");
    throw err;
  }
}

export async function removeHoliday(actor: SessionUser, id: string): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const h = await tx.holiday.findUnique({ where: { id } });
    if (!h) throw new NotFoundError("Feriado não encontrado.");
    await tx.holiday.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "holiday.delete",
      targetType: "sla",
      targetId: id,
      data: { date: h.date.toISOString().slice(0, 10), name: h.name },
    });
  });
  invalidateCalendarCache();
}

export async function getSlaSettings(actor: SessionUser) {
  assertAdmin(actor);
  const db = getDb();
  const [policies, hours, holidays] = await Promise.all([
    db.slaPolicy.findMany(),
    db.businessHours.findMany({ orderBy: { weekday: "asc" } }),
    db.holiday.findMany({ orderBy: { date: "asc" } }),
  ]);
  return { policies, hours, holidays };
}
