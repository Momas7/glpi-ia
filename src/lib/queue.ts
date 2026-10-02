import { PgBoss } from "pg-boss";
import type { Db } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Cliente de transação do Prisma ($transaction interativo). */
export type PrismaTransaction = Parameters<Parameters<Db["$transaction"]>[0]>[0];

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;
const ensuredQueues = new Set<string>();

export function getQueue(): Promise<PgBoss> {
  starting ??= (async () => {
    const instance = new PgBoss({
      connectionString: process.env.DATABASE_URL ?? "",
      schema: "pgboss",
    });
    instance.on("error", (err) => logger.error({ err }, "pg-boss error"));
    await instance.start();
    boss = instance;
    return instance;
  })();
  return starting;
}

async function ensureQueue(instance: PgBoss, name: string) {
  if (ensuredQueues.has(name)) return;
  await instance.createQueue(name, { retryLimit: 3, retryDelay: 1 });
  ensuredQueues.add(name);
}

/**
 * Enfileira um job. Com `tx`, o job é gravado na mesma transação do Prisma:
 * rollback da transação descarta o job (sem jobs órfãos).
 */
export async function enqueue<T extends object>(
  name: string,
  data: T,
  opts: { tx?: PrismaTransaction } = {},
): Promise<string | null> {
  const instance = await getQueue();
  await ensureQueue(instance, name);
  if (!opts.tx) return instance.send(name, data);
  const tx = opts.tx;
  return instance.send(name, data, {
    db: {
      executeSql: async (text, values = []) => {
        const rows = await tx.$queryRawUnsafe<unknown[]>(text, ...values);
        return { rows: rows as never[] };
      },
    },
  });
}

export async function registerHandler<T extends object>(
  name: string,
  handler: (data: T) => Promise<void>,
): Promise<void> {
  const instance = await getQueue();
  await ensureQueue(instance, name);
  await instance.work<T>(name, async (jobs) => {
    for (const job of jobs) await handler(job.data);
  });
}

export async function stopQueue(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: 5000 });
  boss = undefined;
  starting = undefined;
  ensuredQueues.clear();
}
