import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let kb: typeof import("@/modules/kb");
let lead: SessionUser, admin: SessionUser, agent: SessionUser, requester: SessionUser;

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"]): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds: [],
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, AI_ENABLED: "true" });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  kb = await import("@/modules/kb");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  process.env.AI_ENABLED = "true";
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job WHERE name = 'ai.index_article'; END IF; END $$`);
  await db.$executeRawUnsafe(`DELETE FROM "KbChunk"`);
  await db.kbArticle.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
  const mk = (name: string, role: SessionUser["role"]) => db.user.create({ data: { name, email: `${name}@x.com`, role } });
  lead = session(await mk("lead", "TEAM_LEAD"), "TEAM_LEAD");
  admin = session(await mk("admin", "ADMIN"), "ADMIN");
  agent = session(await mk("agent", "AGENT"), "AGENT");
  requester = session(await mk("requester", "REQUESTER"), "REQUESTER");
});

const jobs = async () => {
  const exists = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
  if (!exists[0].ok) return []; // o pg-boss só cria seu schema no primeiro enfileiramento
  return db.$queryRaw<{ data: { articleId: string } }[]>`SELECT data FROM pgboss.job WHERE name = 'ai.index_article'`;
};
const input = { title: "Wi-Fi sem conexão", body: "Reinicie o roteador do andar." };

describe("criar e editar", () => {
  it("o artigo nasce como rascunho e a criação é auditada", async () => {
    const a = await kb.createArticle(lead, input);
    expect(a).toMatchObject({ title: input.title, published: false, createdById: lead.id, updatedById: lead.id });
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: a.id } });
    expect(log).toMatchObject({ action: "kb.create", targetType: "kb", actorId: lead.id });
  });

  it("técnico e solicitante não escrevem (403)", async () => {
    await expect(kb.createArticle(agent, input)).rejects.toMatchObject({ status: 403 });
    await expect(kb.createArticle(requester, input)).rejects.toMatchObject({ status: 403 });
    const a = await kb.createArticle(lead, input);
    await expect(kb.patchArticle(agent, a.id, { title: "Novo título" })).rejects.toMatchObject({ status: 403 });
    await expect(kb.deleteArticle(agent, a.id)).rejects.toMatchObject({ status: 403 });
  });

  it("título curto ou texto vazio são recusados pelo Zod", async () => {
    await expect(kb.createArticle(lead, { title: "ab", body: "texto" })).rejects.toThrow();
    await expect(kb.createArticle(lead, { title: "Título ok", body: "   " })).rejects.toThrow();
  });

  it("editar muda o texto e quem editou", async () => {
    const a = await kb.createArticle(lead, input);
    const b = await kb.patchArticle(admin, a.id, { body: "Troque o cabo." });
    expect(b).toMatchObject({ body: "Troque o cabo.", updatedById: admin.id, createdById: lead.id });
    expect(await db.auditLog.count({ where: { action: "kb.update", targetId: a.id } })).toBe(1);
  });

  it("artigo inexistente: 404", async () => {
    await expect(kb.patchArticle(lead, "nao-existe", { title: "Novo título" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("publicar e indexar", () => {
  it("publicar e despublicar enfileiram a indexação e auditam", async () => {
    const a = await kb.createArticle(lead, input);
    expect(await jobs()).toHaveLength(0); // rascunho não indexa
    await kb.patchArticle(lead, a.id, { published: true });
    await kb.patchArticle(lead, a.id, { published: false });
    expect((await jobs()).map((j) => j.data.articleId)).toEqual([a.id, a.id]);
    const actions = (await db.auditLog.findMany({ where: { targetId: a.id }, orderBy: { createdAt: "asc" } })).map((l) => l.action);
    expect(actions).toEqual(["kb.create", "kb.publish", "kb.unpublish"]);
  });

  it("editar artigo publicado enfileira; editar rascunho não", async () => {
    const a = await kb.createArticle(lead, input);
    await kb.patchArticle(lead, a.id, { body: "rascunho editado" });
    expect(await jobs()).toHaveLength(0);
    await kb.patchArticle(lead, a.id, { published: true });
    await kb.patchArticle(lead, a.id, { body: "publicado editado" });
    expect(await jobs()).toHaveLength(2);
  });

  it("com a IA desligada nada é enfileirado", async () => {
    process.env.AI_ENABLED = "false";
    const a = await kb.createArticle(lead, input);
    await kb.patchArticle(lead, a.id, { published: true });
    expect(await jobs()).toHaveLength(0);
  });

  it("apagar remove o artigo e os trechos e audita", async () => {
    const a = await kb.createArticle(lead, input);
    const zero = `[${new Array(768).fill(0).join(",")}]`;
    await db.$executeRaw`INSERT INTO "KbChunk" ("id","articleId","position","text","contentHash","embedding") VALUES ('k1', ${a.id}, 0, 't', 'h', ${zero}::vector)`;
    await kb.deleteArticle(lead, a.id);
    expect(await db.kbArticle.count()).toBe(0);
    expect(Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "KbChunk"`)[0].n)).toBe(0);
    expect(await db.auditLog.count({ where: { action: "kb.delete", targetId: a.id } })).toBe(1);
  });
});

describe("leitura", () => {
  it("técnico lista só os publicados; líder e admin veem todos", async () => {
    const pub = await kb.createArticle(lead, { title: "Publicado A", body: "x" });
    await kb.patchArticle(lead, pub.id, { published: true });
    await kb.createArticle(lead, { title: "Rascunho B", body: "y" });
    expect((await kb.listArticles(agent)).map((a) => a.title)).toEqual(["Publicado A"]);
    expect((await kb.listArticles(lead)).map((a) => a.title).sort()).toEqual(["Publicado A", "Rascunho B"]);
    expect(await kb.listArticles(admin)).toHaveLength(2);
  });

  it("rascunho dá 404 ao técnico e funciona ao líder; solicitante não lê nada (403)", async () => {
    const draft = await kb.createArticle(lead, input);
    await expect(kb.getArticle(agent, draft.id)).rejects.toMatchObject({ status: 404 });
    expect((await kb.getArticle(lead, draft.id)).id).toBe(draft.id);
    await expect(kb.listArticles(requester)).rejects.toMatchObject({ status: 403 });
    await expect(kb.getArticle(requester, draft.id)).rejects.toMatchObject({ status: 403 });
  });

  it("busca por título trata % e _ como texto", async () => {
    await kb.createArticle(lead, { title: "Backup 100% concluído", body: "x" });
    await kb.createArticle(lead, { title: "Backup parcial", body: "y" });
    expect((await kb.listArticles(lead, { q: "100%" })).map((a) => a.title)).toEqual(["Backup 100% concluído"]);
    expect(await kb.listArticles(lead, { q: "_" })).toHaveLength(0);
    expect(await kb.listArticles(lead, { q: "backup" })).toHaveLength(2);
  });
});
