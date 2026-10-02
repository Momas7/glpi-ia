import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let integrations: typeof import("@/modules/integrations");
let admin: SessionUser;
let fullKey: string, ticketsOnlyKey: string, commentsOnlyKey: string;
let intakeTeam: string, redeTeam: string;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = ORIGIN;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  integrations = await import("@/modules/integrations");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.apiKey.deleteMany();
  await db.category.deleteMany();
  await db.teamMember.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  intakeTeam = (await db.team.create({ data: { name: "Suporte N1" } })).id;
  redeTeam = (await db.team.create({ data: { name: "Infraestrutura" } })).id;
  await db.category.create({ data: { name: "Rede", defaultTeamId: redeTeam } });
  const a = await db.user.create({ data: { name: "Admin", email: "admin@x.com", role: "ADMIN" } });
  admin = { id: a.id, name: a.name, email: a.email, role: "ADMIN", teamIds: [] };
  await db.user.create({ data: { name: "Ana", email: "ana@x.com", role: "REQUESTER" } });
  await db.user.create({ data: { name: "Bia", email: "bia@x.com", role: "REQUESTER" } });
  await db.user.create({ data: { name: "Inativa", email: "inativa@x.com", role: "REQUESTER", active: false } });
  fullKey = (await integrations.createApiKey(admin, { name: "n8n e-mail", scopes: ["tickets:create", "comments:create"] })).key;
  ticketsOnlyKey = (await integrations.createApiKey(admin, { name: "só chamados", scopes: ["tickets:create"] })).key;
  commentsOnlyKey = (await integrations.createApiKey(admin, { name: "só comentários", scopes: ["comments:create"] })).key;
});

async function call(path: "tickets" | "comments", key: string | null, body: unknown, number?: number) {
  const mod = path === "tickets" ? await import("@/app/api/v1/tickets/route") : await import("@/app/api/v1/tickets/[number]/comments/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const req = new Request(`${ORIGIN}/api/v1/x`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const post = mod.POST as unknown as (r: Request, c: { params: Promise<{ number: string }> }) => Promise<Response>;
  return post(req, { params: Promise.resolve({ number: String(number ?? 0) }) });
}

const base = { requesterEmail: "Ana@X.com", title: "Sem acesso ao e-mail", description: "Desde cedo." };

describe("POST /api/v1/tickets", () => {
  it("cria em nome do solicitante (e-mail sem diferenciar maiúsculas) com origem API", async () => {
    const res = await call("tickets", fullKey, base);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ticket).toMatchObject({ number: expect.any(Number), url: expect.stringContaining(`${ORIGIN}/tickets/`) });
    const t = await db.ticket.findUniqueOrThrow({ where: { id: body.ticket.id }, include: { requester: true, events: true } });
    expect([t.source, t.requester.email, t.teamId]).toEqual(["API", "ana@x.com", intakeTeam]);
    expect(t.apiKeyId).not.toBeNull();
    expect(t.events.find((e) => e.type === "CREATED")?.data).toMatchObject({ via: "n8n e-mail" });
  });

  it("solicitante desconhecido ou desativado → 422 requester_not_found", async () => {
    for (const email of ["ninguem@x.com", "inativa@x.com"]) {
      const res = await call("tickets", fullKey, { ...base, requesterEmail: email });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "requester_not_found" });
    }
  });

  it("externalRef repetido devolve o mesmo chamado (200), inclusive em chamadas simultâneas", async () => {
    const first = await call("tickets", fullKey, { ...base, externalRef: "<msg-1@mail>" });
    const again = await call("tickets", fullKey, { ...base, externalRef: "<msg-1@mail>" });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect((await again.json()).ticket.id).toBe((await first.json()).ticket.id);

    const results = await Promise.all(Array.from({ length: 5 }, () => call("tickets", fullKey, { ...base, externalRef: "<msg-2@mail>" })));
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(await db.ticket.count({ where: { externalRef: "<msg-2@mail>" } })).toBe(1);
  });

  it("categoria por nome sem diferenciar maiúsculas; inexistente vai para a equipe de entrada", async () => {
    const withCat = await (await call("tickets", fullKey, { ...base, categoryName: "rede" })).json();
    expect((await db.ticket.findUniqueOrThrow({ where: { id: withCat.ticket.id } })).teamId).toBe(redeTeam);
    const unknown = await (await call("tickets", fullKey, { ...base, categoryName: "Não existe" })).json();
    expect((await db.ticket.findUniqueOrThrow({ where: { id: unknown.ticket.id } })).teamId).toBe(intakeTeam);
  });

  it("401 sem chave; 403 sem o escopo; 413 corpo grande; 400 corpo inválido", async () => {
    expect((await call("tickets", null, base)).status).toBe(401);
    expect((await call("tickets", commentsOnlyKey, base)).status).toBe(403);
    expect((await call("tickets", fullKey, { ...base, description: "x".repeat(70 * 1024) })).status).toBe(413);
    expect((await call("tickets", fullKey, { title: "x" })).status).toBe(400);
  });

  it("61ª requisição no minuto com a mesma chave → 429", async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await call("tickets", ticketsOnlyKey, { invalido: true })).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/v1/tickets/{number}/comments", () => {
  async function ticketOfAna() {
    return (await (await call("tickets", fullKey, base)).json()).ticket as { id: string; number: number };
  }

  it("solicitante comenta no próprio chamado (201, origem API); externalRef repetido → 200 sem duplicar", async () => {
    const t = await ticketOfAna();
    const res = await call("comments", fullKey, { authorEmail: "ana@x.com", body: "Segue o print.", externalRef: "<r-1>" }, t.number);
    expect(res.status).toBe(201);
    const again = await call("comments", fullKey, { authorEmail: "ANA@x.com", body: "Segue o print.", externalRef: "<r-1>" }, t.number);
    expect(again.status).toBe(200);
    const comments = await db.comment.findMany({ where: { ticketId: t.id } });
    expect(comments).toHaveLength(1);
    expect([comments[0].source, comments[0].internal]).toEqual(["API", false]);
  });

  it("pela API só o solicitante comenta: admin ou técnico da equipe recebem 403", async () => {
    const t = await ticketOfAna();
    const agentUser = await db.user.create({ data: { name: "Téc", email: "tec@x.com", role: "AGENT", teams: { create: [{ teamId: intakeTeam }] } } });
    expect((await call("comments", fullKey, { authorEmail: "admin@x.com", body: "Redefina sua senha aqui" }, t.number)).status).toBe(403);
    expect((await call("comments", fullKey, { authorEmail: agentUser.email, body: "Oi" }, t.number)).status).toBe(403);
    expect((await call("comments", fullKey, { authorEmail: "ana@x.com", body: "Oi" }, t.number)).status).toBe(201);
  });

  it("autor sem acesso → 403; chamado inexistente → 404; chave sem escopo → 403", async () => {
    const t = await ticketOfAna();
    expect((await call("comments", fullKey, { authorEmail: "bia@x.com", body: "Oi" }, t.number)).status).toBe(403);
    expect((await call("comments", fullKey, { authorEmail: "ninguem@x.com", body: "Oi" }, t.number)).status).toBe(403);
    expect((await call("comments", fullKey, { authorEmail: "ana@x.com", body: "Oi" }, 999999)).status).toBe(404);
    expect((await call("comments", ticketsOnlyKey, { authorEmail: "ana@x.com", body: "Oi" }, t.number)).status).toBe(403);
  });
});
