import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await startTestDb();
  db = createDb(testDb.url);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

describe("seed fictício", () => {
  it("é idempotente: rodar duas vezes não duplica equipes nem categorias", async () => {
    await seed(db);
    await seed(db);

    const teams = await db.team.findMany({ orderBy: { name: "asc" } });
    expect(teams.map((t) => t.name)).toEqual(["Infraestrutura", "Sistemas", "Suporte N1"]);

    const roots = await db.category.findMany({ where: { parentId: null }, orderBy: { name: "asc" } });
    expect(roots.map((c) => c.name)).toEqual(["Acessos", "Hardware", "Rede", "Software"]);
  });

  it("associa a equipe padrão de cada categoria", async () => {
    const rede = await db.category.findFirstOrThrow({
      where: { name: "Rede", parentId: null },
      include: { defaultTeam: true },
    });
    expect(rede.defaultTeam?.name).toBe("Infraestrutura");
  });
});
