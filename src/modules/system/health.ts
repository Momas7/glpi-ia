import { getDb, type Db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { WORKER_STALE_SECONDS } from "./heartbeat";

export interface Check {
  name: string;
  ok: boolean;
  /** Frase curta e fixa: nunca mensagem de erro interna, caminho nem texto de chamado. */
  detail: string;
}

export interface Readiness {
  status: "ok" | "degraded";
  checks: Check[];
}

const DEFAULT_TIMEOUT_MS = 2000;

/** Roda a verificação com limite de tempo; qualquer erro vira "indisponível" (e só o log interno vê o motivo). */
async function guarded(name: string, timeoutMs: number, run: () => Promise<Check>, fallback: string): Promise<Check> {
  try {
    return await Promise.race([
      run(),
      new Promise<Check>((_, reject) => setTimeout(() => reject(new Error("tempo esgotado")), timeoutMs)),
    ]);
  } catch (err) {
    logger.warn({ err, check: name }, "verificação de saúde falhou");
    return { name, ok: false, detail: fallback };
  }
}

export async function checkReadiness(deps: { db?: Db; now?: () => Date; timeoutMs?: number } = {}): Promise<Readiness> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? (() => new Date()))();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const checks = await Promise.all([
    guarded("banco", timeoutMs, async () => {
      await db.$queryRaw`SELECT 1`;
      return { name: "banco", ok: true, detail: "responde" };
    }, "indisponível"),
    guarded("vetor", timeoutMs, async () => {
      const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_extension WHERE extname = 'vector'`;
      return rows.length > 0 ? { name: "vetor", ok: true, detail: "extensão instalada" } : { name: "vetor", ok: false, detail: "extensão ausente" };
    }, "indisponível"),
    guarded("migracoes", timeoutMs, async () => {
      const rows = await db.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
      return rows[0].n === 0 ? { name: "migracoes", ok: true, detail: "sem migração pendente" } : { name: "migracoes", ok: false, detail: "migração com falha" };
    }, "indisponível"),
    guarded("fila", timeoutMs, async () => {
      const rows = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
      return rows[0].ok ? { name: "fila", ok: true, detail: "fila acessível" } : { name: "fila", ok: false, detail: "fila ainda não criada" };
    }, "inacessível"),
    guarded("worker", timeoutMs, async () => {
      const beat = await db.workerHeartbeat.findUnique({ where: { service: "worker" } });
      if (!beat) return { name: "worker", ok: false, detail: "sem batimento" };
      const age = Math.round((now.getTime() - beat.beatAt.getTime()) / 1000);
      return age <= WORKER_STALE_SECONDS
        ? { name: "worker", ok: true, detail: `batimento há ${age} s` }
        : { name: "worker", ok: false, detail: `batimento atrasado (${age} s)` };
    }, "indisponível"),
  ]);
  return { status: checks.every((c) => c.ok) ? "ok" : "degraded", checks };
}
