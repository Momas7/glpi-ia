import type { Db } from "@/lib/db";

export interface QueuedEvent {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown> & { [k: string]: unknown };
  raw: string;
}

/** Corpos de webhook enfileirados (sem worker consumindo), na ordem de criação. */
export async function queuedEvents(db: Db, type?: string): Promise<QueuedEvent[]> {
  const rows = await db.$queryRaw<{ data: { body: string } }[]>`
    SELECT data FROM pgboss.job WHERE name = 'webhook.deliver' ORDER BY created_on, id`;
  return rows
    .map((r) => ({ ...(JSON.parse(r.data.body) as Omit<QueuedEvent, "raw">), raw: r.data.body }))
    .filter((e) => !type || e.type === type);
}
