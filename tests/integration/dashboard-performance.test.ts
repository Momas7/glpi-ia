import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";
import { sp } from "./helpers/dashboard-data";

let testDb: TestDb;
let db: Db;
let between: typeof import("@/modules/dashboard/queries").between;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  ({ between } = await import("@/modules/dashboard/queries"));

  // ~30 mil chamados em 3 anos: o suficiente para o planejador preferir índice a varrer a tabela
  const user = await db.user.create({ data: { name: "Req", email: "req@x.com", role: "REQUESTER" } });
  const DAY = 86_400_000;
  const start = sp(2024, 1, 1).getTime();
  const rows = Array.from({ length: 30_000 }, (_, i) => {
    const createdAt = new Date(start + Math.floor((i / 30_000) * 1095) * DAY + (i % 24) * 3_600_000);
    return {
      title: `t${i}`,
      description: "d",
      requesterId: user.id,
      status: "CLOSED" as const,
      createdAt,
      resolvedAt: new Date(createdAt.getTime() + DAY),
      firstRespondedAt: new Date(createdAt.getTime() + 3_600_000),
    };
  });
  for (let i = 0; i < rows.length; i += 5_000) await db.ticket.createMany({ data: rows.slice(i, i + 5_000) });
  await db.$executeRawUnsafe('ANALYZE "Ticket"');
}, 180_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

const WINDOW = { from: sp(2025, 6, 1), to: sp(2025, 6, 8) }; // uma semana em três anos

async function plan(column: string): Promise<string> {
  const rows = await db.$queryRaw<{ "QUERY PLAN": string }[]>(
    Prisma.sql`EXPLAIN SELECT count(*) FROM "Ticket" t WHERE ${between(column, WINDOW)}`,
  );
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

describe("filtros de período usam índice (sem varrer a tabela)", () => {
  it.each(["createdAt", "resolvedAt", "firstRespondedAt"])("%s", async (column) => {
    const text = await plan(column);
    expect(text, text).toMatch(/Index|Bitmap/);
    expect(text, text).not.toMatch(/Seq Scan on "Ticket"/);
  });

  it("os índices existem", async () => {
    const rows = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = 'Ticket'`;
    const defs = rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/\("resolvedAt"\)/);
    expect(defs).toMatch(/\("firstRespondedAt"\)/);
  });
});
