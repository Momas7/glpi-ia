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
  const t = await db.ticket.create({ data: { title: "t", description: "d", requesterId: u.id } });
  return { u, t };
};

describe("schema do RAG", () => {
  it("Ticket.resolution e Comment.sources gravam e leem", async () => {
    const { u, t } = await mkTicket("a@x.com");
    await db.ticket.update({ where: { id: t.id }, data: { resolution: "Reiniciei o switch do andar." } });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).resolution).toBe("Reiniciei o switch do andar.");
    const c = await db.comment.create({
      data: { ticketId: t.id, authorId: u.id, body: "rascunho", internal: true, source: "AI_DRAFT", sources: [{ kind: "article", id: "x", title: "T" }] },
    });
    expect(c.sources).toEqual([{ kind: "article", id: "x", title: "T" }]);
  });

  it("TicketRating: nota de 1 a 5, uma por chamado, some com o chamado", async () => {
    const { u, t } = await mkTicket("b@x.com");
    await expect(db.ticketRating.create({ data: { ticketId: t.id, raterId: u.id, stars: 6 } })).rejects.toThrow();
    await expect(db.ticketRating.create({ data: { ticketId: t.id, raterId: u.id, stars: 0 } })).rejects.toThrow();
    await db.ticketRating.create({ data: { ticketId: t.id, raterId: u.id, stars: 5, comment: "ótimo" } });
    await expect(db.ticketRating.create({ data: { ticketId: t.id, raterId: u.id, stars: 4 } })).rejects.toThrow();
    await expect(
      db.ticketRating.create({ data: { ticketId: (await mkTicket("b2@x.com")).t.id, raterId: u.id, stars: 3, comment: "x".repeat(1001) } }),
    ).rejects.toThrow();
    await db.ticket.delete({ where: { id: t.id } });
    expect(await db.ticketRating.count({ where: { ticketId: t.id } })).toBe(0);
  });

  it("KbArticle nasce como rascunho", async () => {
    const u = await db.user.create({ data: { name: "L", email: "l@x.com", role: "TEAM_LEAD" } });
    const a = await db.kbArticle.create({ data: { title: "Wi-Fi", body: "texto", createdById: u.id, updatedById: u.id } });
    expect(a.published).toBe(false);
  });

  it("KbChunk guarda vetor de 768 dimensões, recusa outras e some com o artigo", async () => {
    const u = await db.user.create({ data: { name: "L2", email: "l2@x.com", role: "TEAM_LEAD" } });
    const a = await db.kbArticle.create({ data: { title: "Rede", body: "texto", createdById: u.id, updatedById: u.id } });
    await db.$executeRaw`INSERT INTO "KbChunk" ("id","articleId","position","text","contentHash","embedding") VALUES ('c1', ${a.id}, 0, 'um', 'h1', ${vec(0)}::vector)`;
    await db.$executeRaw`INSERT INTO "KbChunk" ("id","articleId","position","text","contentHash","embedding") VALUES ('c2', ${a.id}, 1, 'dois', 'h2', ${vec(5)}::vector)`;
    await expect(
      db.$executeRaw`INSERT INTO "KbChunk" ("id","articleId","position","text","contentHash","embedding") VALUES ('c3', ${a.id}, 2, 'três', 'h3', '[1,2,3]'::vector)`,
    ).rejects.toThrow();
    const nearest = await db.$queryRaw<{ id: string; sim: number }[]>`
      SELECT "id", 1 - ("embedding" <=> ${vec(5)}::vector) AS sim FROM "KbChunk" ORDER BY "embedding" <=> ${vec(5)}::vector LIMIT 1`;
    expect(nearest[0].id).toBe("c2");
    expect(Number(nearest[0].sim)).toBeCloseTo(1);
    await db.kbArticle.delete({ where: { id: a.id } });
    expect(Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "KbChunk"`)[0].n)).toBe(0);
  });

  it("TicketEmbedding: um por chamado, mesma busca por cosseno, some com o chamado", async () => {
    const { t } = await mkTicket("c@x.com");
    await db.$executeRaw`INSERT INTO "TicketEmbedding" ("ticketId","contentHash","embedding") VALUES (${t.id}, 'h', ${vec(2)}::vector)`;
    await expect(
      db.$executeRaw`INSERT INTO "TicketEmbedding" ("ticketId","contentHash","embedding") VALUES (${t.id}, 'h2', ${vec(3)}::vector)`,
    ).rejects.toThrow();
    const rows = await db.$queryRaw<{ ticketId: string }[]>`SELECT "ticketId" FROM "TicketEmbedding" ORDER BY "embedding" <=> ${vec(2)}::vector LIMIT 1`;
    expect(rows[0].ticketId).toBe(t.id);
    await db.ticket.delete({ where: { id: t.id } });
    expect(Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "TicketEmbedding"`)[0].n)).toBe(0);
  });
});
