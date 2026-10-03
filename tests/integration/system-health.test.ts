import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let system: typeof import("@/modules/system");

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  system = await import("@/modules/system");
  // O schema do pg-boss nasce no primeiro enfileiramento.
  const { getQueue } = await import("@/lib/queue");
  await getQueue();
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.workerHeartbeat.deleteMany();
});

const NOW = new Date("2026-10-10T12:00:00Z");
const beat = (secondsAgo: number) =>
  db.workerHeartbeat.upsert({
    where: { service: "worker" },
    update: { beatAt: new Date(NOW.getTime() - secondsAgo * 1000) },
    create: { service: "worker", beatAt: new Date(NOW.getTime() - secondsAgo * 1000) },
  });
const find = (r: { checks: { name: string; ok: boolean; detail: string }[] }, name: string) => r.checks.find((c) => c.name === name)!;

describe("checkReadiness", () => {
  it("tudo saudável: cinco verificações verdes", async () => {
    await beat(10);
    const r = await system.checkReadiness({ db, now: () => NOW });
    expect(r.status).toBe("ok");
    expect(r.checks.map((c) => c.name)).toEqual(["banco", "vetor", "migracoes", "fila", "worker"]);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("sem batimento o worker fica vermelho e o status degradado", async () => {
    const r = await system.checkReadiness({ db, now: () => NOW });
    expect(r.status).toBe("degraded");
    expect(find(r, "worker").ok).toBe(false);
    expect(find(r, "banco").ok).toBe(true);
  });

  it("batimento de 60 s está vivo; de 200 s está atrasado", async () => {
    await beat(60);
    expect(find(await system.checkReadiness({ db, now: () => NOW }), "worker").ok).toBe(true);
    await beat(200);
    const r = await system.checkReadiness({ db, now: () => NOW });
    expect(find(r, "worker").ok).toBe(false);
    expect(find(r, "worker").detail).toMatch(/atrasado/);
  });

  it("migração com falha pendente derruba as migrações", async () => {
    await beat(5);
    await db.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","started_at","applied_steps_count") VALUES ('falha-teste','x','99999999999999_falha',now(),0)`);
    try {
      const r = await system.checkReadiness({ db, now: () => NOW });
      expect(find(r, "migracoes").ok).toBe(false);
      expect(r.status).toBe("degraded");
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE "id" = 'falha-teste'`);
    }
  });

  it("uma migração desfeita (rolled back) não conta como falha pendente", async () => {
    await beat(5);
    await db.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","started_at","rolled_back_at","applied_steps_count") VALUES ('desfeita-teste','x','99999999999998_desfeita',now(),now(),0)`);
    try {
      expect(find(await system.checkReadiness({ db, now: () => NOW }), "migracoes").ok).toBe(true);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE "id" = 'desfeita-teste'`);
    }
  });

  it("extensão vector ausente e fila inexistente derrubam as verificações (banco simulado)", async () => {
    const stub = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        if (sql.includes("pg_extension")) return [];
        if (sql.includes("to_regclass")) return [{ ok: false }];
        if (sql.includes("_prisma_migrations")) return [{ n: 0 }];
        return [{ "?column?": 1 }];
      },
      workerHeartbeat: { findUnique: async () => ({ beatAt: new Date(NOW.getTime() - 5000) }) },
    } as unknown as Db;
    const r = await system.checkReadiness({ db: stub, now: () => NOW });
    expect(find(r, "vetor").ok).toBe(false);
    expect(find(r, "fila").ok).toBe(false);
    expect(find(r, "banco").ok).toBe(true);
    expect(r.status).toBe("degraded");
  });

  it("banco que não responde: só o banco e o que depende dele ficam vermelhos, sem vazar a mensagem do erro", async () => {
    const broken = {
      $queryRaw: async () => {
        throw new Error('connect ECONNREFUSED postgres://glpi:SEGREDO@db:5432/glpi');
      },
      workerHeartbeat: {
        findUnique: async () => {
          throw new Error("secret path /var/lib/postgres");
        },
      },
    } as unknown as Db;
    const r = await system.checkReadiness({ db: broken, now: () => NOW });
    expect(r.status).toBe("degraded");
    expect(find(r, "banco").ok).toBe(false);
    const body = JSON.stringify(r);
    expect(body).not.toContain("SEGREDO");
    expect(body).not.toContain("postgres://");
    expect(body).not.toContain("/var/lib");
  });

  it("verificação lenta estoura o tempo limite e fica vermelha", async () => {
    const slow = {
      $queryRaw: () => new Promise(() => {}),
      workerHeartbeat: { findUnique: () => new Promise(() => {}) },
    } as unknown as Db;
    const r = await system.checkReadiness({ db: slow, now: () => NOW, timeoutMs: 50 });
    expect(r.status).toBe("degraded");
    expect(r.checks.every((c) => !c.ok)).toBe(true);
  });
});

describe("recordHeartbeat", () => {
  it("grava e atualiza o batimento do serviço", async () => {
    await system.recordHeartbeat("worker", db);
    const first = (await db.workerHeartbeat.findUniqueOrThrow({ where: { service: "worker" } })).beatAt;
    await new Promise((r) => setTimeout(r, 20));
    await system.recordHeartbeat("worker", db);
    const second = (await db.workerHeartbeat.findUniqueOrThrow({ where: { service: "worker" } })).beatAt;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(await db.workerHeartbeat.count()).toBe(1);
  });
});

describe("GET /api/health/ready", () => {
  it("200 com status ok quando tudo está saudável e 503 quando o worker não bate", async () => {
    const { GET } = await import("@/app/api/health/ready/route");
    await system.recordHeartbeat("worker", db);
    const ok = await GET();
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ok");
    await db.workerHeartbeat.deleteMany();
    const bad = await GET();
    expect(bad.status).toBe(503);
    const body = await bad.json();
    expect(body.status).toBe("degraded");
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|\/home\/|stack/i);
  });
});
