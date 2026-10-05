import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { enqueue, stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let system: typeof import("@/modules/system");
let admin: SessionUser, lead: SessionUser, agent: SessionUser;

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"]): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds: [],
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  system = await import("@/modules/system");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  delete process.env.BACKUP_STATE_FILE;
  await db.webhookDelivery.deleteMany();
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job; END IF; END $$`);
  await db.$executeRawUnsafe(`DELETE FROM "KbChunk"`);
  await db.$executeRawUnsafe(`DELETE FROM "TicketEmbedding"`);
  await db.ticket.deleteMany();
  await db.kbArticle.deleteMany();
  await db.user.deleteMany();
  const mk = (name: string, role: SessionUser["role"]) => db.user.create({ data: { name, email: `${name}@x.com`, role } });
  admin = session(await mk("adm", "ADMIN"), "ADMIN");
  lead = session(await mk("lead", "TEAM_LEAD"), "TEAM_LEAD");
  agent = session(await mk("agent", "AGENT"), "AGENT");
});

describe("getSystemOverview", () => {
  it("só o admin enxerga; líder e técnico recebem 403", async () => {
    await expect(system.getSystemOverview(lead)).rejects.toMatchObject({ status: 403 });
    await expect(system.getSystemOverview(agent)).rejects.toMatchObject({ status: 403 });
    const o = await system.getSystemOverview(admin);
    expect(o.readiness.checks.length).toBeGreaterThan(0);
  });

  it("filas: pendentes, em andamento e falhas por fila, com a idade do mais antigo", async () => {
    await enqueue("fila.teste", { n: 1 });
    await enqueue("fila.teste", { n: 2 });
    await db.$executeRawUnsafe(`UPDATE pgboss.job SET created_on = now() - interval '10 minutes' WHERE name = 'fila.teste' AND (data->>'n') = '1'`);
    await db.$executeRawUnsafe(`UPDATE pgboss.job SET state = 'failed' WHERE name = 'fila.teste' AND (data->>'n') = '2'`);
    await enqueue("outra.fila", { n: 3 });
    const q = (await system.getQueueStats(db)).find((x) => x.name === "fila.teste")!;
    expect(q).toMatchObject({ pending: 1, failed: 1, active: 0 });
    expect(q.oldestPendingSeconds).toBeGreaterThanOrEqual(595);
    expect((await system.getQueueStats(db)).map((x) => x.name)).toContain("outra.fila");
  });

  it("sem o schema do pg-boss as filas vêm vazias, sem lançar", async () => {
    const stub = { $queryRaw: async () => [{ ok: false }] } as unknown as Db;
    expect(await system.getQueueStats(stub)).toEqual([]);
  });

  it("avisos ao n8n das últimas 24 h: entregues, pendentes e falhos (os mais antigos ficam de fora)", async () => {
    const mk = (status: "DELIVERED" | "PENDING" | "FAILED", hoursAgo: number, n: number) =>
      db.webhookDelivery.create({ data: { eventId: `ev-${status}-${n}`, type: "ticket.created", status, createdAt: new Date(Date.now() - hoursAgo * 3600_000) } });
    await mk("DELIVERED", 1, 1);
    await mk("DELIVERED", 2, 2);
    await mk("PENDING", 3, 3);
    await mk("FAILED", 4, 4);
    await mk("FAILED", 30, 5); // fora da janela
    const o = await system.getSystemOverview(admin);
    expect(o.webhooks).toEqual({ delivered: 2, pending: 1, failed: 1 });
  });

  it("banco: tamanho positivo e contagens de chamados, artigos publicados e vetores", async () => {
    const u = await db.user.create({ data: { name: "r", email: "r@x.com", role: "REQUESTER" } });
    const t = await db.ticket.create({ data: { title: "t", description: "d", requesterId: u.id } });
    await db.ticket.create({ data: { title: "t2", description: "d", requesterId: u.id } });
    const a = await db.kbArticle.create({ data: { title: "Pub", body: "x", published: true, createdById: u.id, updatedById: u.id } });
    await db.kbArticle.create({ data: { title: "Rasc", body: "x", published: false, createdById: u.id, updatedById: u.id } });
    const zero = `[${new Array(768).fill(0).join(",")}]`;
    await db.$executeRaw`INSERT INTO "KbChunk" ("id","articleId","position","text","contentHash","embedding") VALUES ('k1', ${a.id}, 0, 't', 'h', ${zero}::vector)`;
    await db.$executeRaw`INSERT INTO "TicketEmbedding" ("ticketId","contentHash","embedding") VALUES (${t.id}, 'h', ${zero}::vector)`;
    const o = await system.getSystemOverview(admin);
    expect(o.database.sizeBytes).toBeGreaterThan(0);
    expect(o.database).toMatchObject({ tickets: 2, articles: 1, vectors: 2 });
  });

  it("backup: não configurado sem a variável; com o arquivo, devolve o estado", async () => {
    expect((await system.getSystemOverview(admin)).backup).toMatchObject({ configured: false, state: null });
    const dir = mkdtempSync(join(tmpdir(), "bk-"));
    writeFileSync(join(dir, "estado-backup.json"), JSON.stringify({ lastBackupAt: new Date().toISOString(), lastBackupBytes: 2048, lastBackupOk: true }));
    process.env.BACKUP_STATE_FILE = join(dir, "estado-backup.json");
    const o = await system.getSystemOverview(admin);
    expect(o.backup.configured).toBe(true);
    expect(o.backup.state).toMatchObject({ lastBackupOk: true, lastBackupBytes: 2048 });
    expect(o.backup.stale).toBe(false);
  });
});
