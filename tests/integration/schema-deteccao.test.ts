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

const vec = (hot: number, dims = 768) => `[${Array.from({ length: dims }, (_, i) => (i === hot ? 1 : 0)).join(",")}]`;

const mkTicket = async (email: string) => {
  const u = await db.user.create({ data: { name: "U", email, role: "REQUESTER" } });
  return db.ticket.create({ data: { title: "t", description: "d", requesterId: u.id } });
};

describe("schema da detecção", () => {
  it("AiSuggestion aceita DUPLICATE e SUMMARY, um de cada tipo por chamado", async () => {
    const t = await mkTicket("a@x.com");
    await db.aiSuggestion.create({ data: { ticketId: t.id, kind: "DUPLICATE", payload: { candidates: [] }, confidence: 0.9 } });
    await db.aiSuggestion.create({ data: { ticketId: t.id, kind: "SUMMARY", payload: { text: "resumo", commentCount: 3 }, confidence: 1 } });
    await expect(
      db.aiSuggestion.create({ data: { ticketId: t.id, kind: "SUMMARY", payload: {}, confidence: 1 } }),
    ).rejects.toThrow();
    expect(await db.aiSuggestion.count({ where: { ticketId: t.id } })).toBe(2);
  });

  it("IncidentGroup nasce aberto e o chamado se liga a ele", async () => {
    const group = await db.incidentGroup.create({ data: { title: "Internet fora do ar" } });
    expect(group.status).toBe("OPEN");
    expect(group.closedAt).toBeNull();
    const t = await mkTicket("b@x.com");
    await db.ticket.update({ where: { id: t.id }, data: { incidentGroupId: group.id } });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).incidentGroupId).toBe(group.id);
  });

  it("apagar o grupo solta os chamados (não os apaga)", async () => {
    const group = await db.incidentGroup.create({ data: { title: "Outro" } });
    const t = await mkTicket("c@x.com");
    await db.ticket.update({ where: { id: t.id }, data: { incidentGroupId: group.id } });
    await db.incidentGroup.delete({ where: { id: group.id } });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).incidentGroupId).toBeNull();
  });

  it("OpenTicketVector guarda 768 dimensões, recusa outras, um por chamado e some com o chamado", async () => {
    const t = await mkTicket("d@x.com");
    await db.$executeRaw`INSERT INTO "OpenTicketVector" ("ticketId","contentHash","embedding") VALUES (${t.id}, 'h', ${vec(1)}::vector)`;
    await expect(
      db.$executeRaw`INSERT INTO "OpenTicketVector" ("ticketId","contentHash","embedding") VALUES (${t.id}, 'h2', ${vec(2)}::vector)`,
    ).rejects.toThrow();
    const t2 = await mkTicket("e@x.com");
    await expect(
      db.$executeRaw`INSERT INTO "OpenTicketVector" ("ticketId","contentHash","embedding") VALUES (${t2.id}, 'h', '[1,2,3]'::vector)`,
    ).rejects.toThrow();
    const nearest = await db.$queryRaw<{ ticketId: string; sim: number }[]>`
      SELECT "ticketId", 1 - ("embedding" <=> ${vec(1)}::vector) AS sim FROM "OpenTicketVector" ORDER BY "embedding" <=> ${vec(1)}::vector LIMIT 1`;
    expect(nearest[0].ticketId).toBe(t.id);
    expect(Number(nearest[0].sim)).toBeCloseTo(1);
    await db.ticket.delete({ where: { id: t.id } });
    expect(Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "OpenTicketVector"`)[0].n)).toBe(0);
  });
});
