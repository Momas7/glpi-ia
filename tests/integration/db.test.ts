import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  testDb = await startTestDb();
  db = createDb(testDb.url);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

describe("banco de dados", () => {
  it("habilita as extensões vector e pg_trgm", async () => {
    const rows = await db.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension`;
    const names = rows.map((r) => r.extname);
    expect(names).toContain("vector");
    expect(names).toContain("pg_trgm");
  });

  it("grava e lê uma Team", async () => {
    await db.team.create({ data: { name: "Infraestrutura" } });
    const team = await db.team.findUnique({ where: { name: "Infraestrutura" } });
    expect(team?.name).toBe("Infraestrutura");
  });
});
