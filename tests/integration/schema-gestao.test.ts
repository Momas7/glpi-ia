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

const mkUser = (email: string) => db.user.create({ data: { name: "U", email, role: "ADMIN" } });

describe("schema da gestão", () => {
  it("grava e lê AuditLog com dados JSON", async () => {
    const u = await mkUser("audit@x.com");
    await db.auditLog.create({
      data: { actorId: u.id, action: "user.role_change", targetType: "user", targetId: u.id, data: { from: "AGENT", to: "ADMIN" } },
    });
    const row = await db.auditLog.findFirstOrThrow({ where: { targetId: u.id } });
    expect(row.data).toEqual({ from: "AGENT", to: "ADMIN" });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("aceita TicketEvent sem ator (ação do sistema)", async () => {
    const u = await mkUser("req@x.com");
    const t = await db.ticket.create({ data: { title: "t", description: "d", requesterId: u.id } });
    const ev = await db.ticketEvent.create({ data: { ticketId: t.id, actorId: null, type: "AUTO_CLOSED", data: {} } });
    expect(ev.actorId).toBeNull();
  });

  it("Invite aceita revokedAt", async () => {
    const u = await mkUser("inv@x.com");
    const inv = await db.invite.create({
      data: { email: "n@x.com", role: "AGENT", tokenHash: "h1", expiresAt: new Date(Date.now() + 1000), createdById: u.id, revokedAt: new Date() },
    });
    expect(inv.revokedAt).toBeInstanceOf(Date);
  });
});
