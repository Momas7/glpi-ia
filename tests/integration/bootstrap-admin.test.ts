import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let boot: typeof import("@/modules/auth/bootstrap");

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  boot = await import("@/modules/auth/bootstrap");
});
afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});
beforeEach(async () => {
  await db.user.deleteMany();
});

describe("createAdminUser (primeiro administrador)", () => {
  it("cria um ADMIN com senha argon2id e e-mail em minúsculas", async () => {
    await boot.createAdminUser({ name: "Ana", email: "Ana@Empresa.com", password: "Senha-Forte-Do-Admin-1" });
    const u = await db.user.findUniqueOrThrow({ where: { email: "ana@empresa.com" } });
    expect(u.role).toBe("ADMIN");
    expect(u.passwordHash?.startsWith("$argon2id$")).toBe(true);
  });

  it("recusa senha que não atende à política", async () => {
    await expect(boot.createAdminUser({ name: "A", email: "a@x.com", password: "123" })).rejects.toThrow(/senha/i);
    expect(await db.user.count()).toBe(0);
  });

  it("recusa e-mail já cadastrado sem alterar a conta existente", async () => {
    await boot.createAdminUser({ name: "A", email: "a@x.com", password: "Senha-Forte-Do-Admin-1" });
    await expect(
      boot.createAdminUser({ name: "B", email: "A@x.com", password: "Outra-Senha-Forte-22" }),
    ).rejects.toThrow(/já existe/i);
    expect((await db.user.findUniqueOrThrow({ where: { email: "a@x.com" } })).name).toBe("A");
  });
});
