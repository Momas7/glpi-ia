import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function newUser(email: string) {
  return db.user.create({ data: { name: "Fulana", email, role: "REQUESTER" } });
}

describe("schema de identidade e chamados", () => {
  it("cria os índices esperados em Ticket", async () => {
    const rows = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'Ticket'`;
    const defs = rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/\(status, "teamId", "assigneeId"\)/);
    expect(defs).toMatch(/\("createdAt"\)/);
    expect(defs).toMatch(/USING gin \(title gin_trgm_ops\)/);
  });

  it("não permite dois usuários com o mesmo e-mail", async () => {
    await newUser("dup@example.com");
    await expect(newUser("dup@example.com")).rejects.toThrow();
  });

  it("gera números de chamado sequenciais e únicos", async () => {
    const u = await newUser("seq@example.com");
    const mk = () =>
      db.ticket.create({
        data: { title: "t", description: "d", requesterId: u.id },
      });
    const a = await mk();
    const b = await mk();
    expect(b.number).toBe(a.number + 1);
    expect(a.status).toBe("NEW");
    expect(a.priority).toBe("MEDIUM");
    expect(a.type).toBe("REQUEST");
  });
});
