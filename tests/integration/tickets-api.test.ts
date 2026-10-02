import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let uploadDir: string;
let cookies: { reqA: string; reqB: string; agent1: string; admin: string };
let ids: { reqA: string; t1: string };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

beforeAll(async () => {
  testDb = await startTestDb();
  uploadDir = mkdtempSync(join(tmpdir(), "uploads-"));
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = ORIGIN;
  process.env.UPLOAD_DIR = uploadDir;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.attachment.deleteMany();
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  const { createSession } = await import("@/modules/auth/session");
  const t1 = await db.team.create({ data: { name: "T1" } });
  const mk = async (name: string, role: "REQUESTER" | "AGENT" | "ADMIN", teams: string[] = []) => {
    const u = await db.user.create({
      data: { name, email: `${name}@x.com`, role, teams: { create: teams.map((teamId) => ({ teamId })) } },
    });
    return { id: u.id, cookie: `session=${await createSession(u.id)}` };
  };
  const reqA = await mk("reqA", "REQUESTER");
  const reqB = await mk("reqB", "REQUESTER");
  const agent1 = await mk("agent1", "AGENT", [t1.id]);
  const admin = await mk("admin", "ADMIN");
  cookies = { reqA: reqA.cookie, reqB: reqB.cookie, agent1: agent1.cookie, admin: admin.cookie };
  ids = { reqA: reqA.id, t1: t1.id };
});

type Ctx = { params: Promise<Record<string, string>> };
const ctx = (params: Record<string, string> = {}): Ctx => ({ params: Promise.resolve(params) });

async function call(
  mod: string,
  method: "GET" | "POST" | "PATCH",
  opts: { cookie?: string; body?: unknown; form?: FormData; origin?: string; query?: string; params?: Record<string, string> } = {},
) {
  const m = await import(mod);
  const headers: Record<string, string> = { "x-forwarded-for": "5.5.5.5" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== "GET") headers.origin = opts.origin ?? ORIGIN;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const req = new Request(`${ORIGIN}/api/x${opts.query ?? ""}`, { method, headers, body });
  return m[method](req, ctx(opts.params));
}

const TICKETS = "@/app/api/tickets/route";
const TICKET = "@/app/api/tickets/[id]/route";
const COMMENTS = "@/app/api/tickets/[id]/comments/route";
const ATTACH = "@/app/api/tickets/[id]/attachments/route";
const DOWNLOAD = "@/app/api/tickets/[id]/attachments/[attachmentId]/route";

async function newTicket(cookie = cookies.reqA, extra: object = {}) {
  const res = await call(TICKETS, "POST", { cookie, body: { title: "Impressora", description: "não imprime", ...extra } });
  expect(res.status).toBe(201);
  return (await res.json()).ticket as { id: string; teamId: string | null };
}

describe("autenticação e proteções gerais", () => {
  it("sem cookie → 401", async () => {
    expect((await call(TICKETS, "GET")).status).toBe(401);
  });

  it("POST com Origin de outro domínio → 403", async () => {
    const res = await call(TICKETS, "POST", {
      cookie: cookies.reqA,
      origin: "http://evil.example",
      body: { title: "Impressora", description: "x" },
    });
    expect(res.status).toBe(403);
  });

  it("corpo inválido → 400 com lista de campos", async () => {
    const res = await call(TICKETS, "POST", { cookie: cookies.reqA, body: { title: "", description: "" } });
    expect(res.status).toBe(400);
    expect((await res.json()).issues.length).toBeGreaterThan(0);
  });
});

describe("chamados", () => {
  it("solicitante lendo chamado de outro → 404; o dono → 200", async () => {
    const t = await newTicket();
    expect((await call(TICKET, "GET", { cookie: cookies.reqB, params: { id: t.id } })).status).toBe(404);
    expect((await call(TICKET, "GET", { cookie: cookies.reqA, params: { id: t.id } })).status).toBe(200);
  });

  it("id inexistente → 404", async () => {
    expect((await call(TICKET, "GET", { cookie: cookies.admin, params: { id: "nao-existe" } })).status).toBe(404);
  });

  it("solicitante não escolhe a equipe ao criar (campo ignorado)", async () => {
    const t = await newTicket(cookies.reqA, { teamId: ids.t1 });
    expect(t.teamId).toBeNull();
  });

  it("listagem: pageSize enorme é limitado e página distante devolve vazio (sem 500)", async () => {
    await newTicket();
    const big = await call(TICKETS, "GET", { cookie: cookies.reqA, query: "?pageSize=100000" });
    expect(big.status).toBe(200);
    expect((await big.json()).pageSize).toBe(100);
    const far = await call(TICKETS, "GET", { cookie: cookies.reqA, query: "?page=9999" });
    expect(far.status).toBe(200);
    expect((await far.json()).items).toEqual([]);
  });

  it("PATCH muda status: agente da equipe sim; transição inválida → 409; solicitante → 403", async () => {
    const t = await newTicket(cookies.agent1, { teamId: ids.t1 });
    const ok = await call(TICKET, "PATCH", { cookie: cookies.agent1, params: { id: t.id }, body: { status: "OPEN" } });
    expect(ok.status).toBe(200);
    const bad = await call(TICKET, "PATCH", { cookie: cookies.agent1, params: { id: t.id }, body: { status: "NEW" } });
    expect(bad.status).toBe(409);
    const own = await newTicket(cookies.reqA);
    const denied = await call(TICKET, "PATCH", { cookie: cookies.reqA, params: { id: own.id }, body: { status: "OPEN" } });
    expect(denied.status).toBe(403);
  });
});

describe("comentários", () => {
  it("HTML é gravado e devolvido como texto literal", async () => {
    const t = await newTicket();
    const payload = "<script>alert(1)</script> <img src=x onerror=alert(2)>";
    const res = await call(COMMENTS, "POST", { cookie: cookies.reqA, params: { id: t.id }, body: { body: payload, internal: false } });
    expect(res.status).toBe(201);
    const list = await (await call(COMMENTS, "GET", { cookie: cookies.reqA, params: { id: t.id } })).json();
    expect(list.comments[0].body).toBe(payload);
  });

  it("nota interna: solicitante não envia nem vê; agente envia e vê", async () => {
    const t = await newTicket(cookies.reqA, {});
    await db.ticket.update({ where: { id: t.id }, data: { teamId: ids.t1 } });
    const denied = await call(COMMENTS, "POST", { cookie: cookies.reqA, params: { id: t.id }, body: { body: "segredo", internal: true } });
    expect(denied.status).toBe(403);
    const ok = await call(COMMENTS, "POST", { cookie: cookies.agent1, params: { id: t.id }, body: { body: "nota técnica", internal: true } });
    expect(ok.status).toBe(201);
    await call(COMMENTS, "POST", { cookie: cookies.agent1, params: { id: t.id }, body: { body: "resposta pública", internal: false } });

    const asReq = await (await call(COMMENTS, "GET", { cookie: cookies.reqA, params: { id: t.id } })).json();
    expect(asReq.comments.map((c: { body: string }) => c.body)).toEqual(["resposta pública"]);
    const asAgent = await (await call(COMMENTS, "GET", { cookie: cookies.agent1, params: { id: t.id } })).json();
    expect(asAgent.comments).toHaveLength(2);
  });

  it("comentar em chamado alheio → 404", async () => {
    const t = await newTicket();
    const res = await call(COMMENTS, "POST", { cookie: cookies.reqB, params: { id: t.id }, body: { body: "oi", internal: false } });
    expect(res.status).toBe(404);
  });
});

describe("anexos", () => {
  const upload = async (cookie: string, ticketId: string, name: string, content: Buffer, type = "application/octet-stream") => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(content)], name, { type }));
    return call(ATTACH, "POST", { cookie, params: { id: ticketId }, form });
  };

  it("aceita PNG válido e grava com nome gerado dentro de UPLOAD_DIR, ignorando '../' do nome original", async () => {
    const t = await newTicket();
    const before = readdirSync(uploadDir).length;
    const res = await upload(cookies.reqA, t.id, "../../x.png", PNG, "image/png");
    expect(res.status).toBe(201);
    const { attachment } = await res.json();
    expect(attachment.filename).not.toContain("/");
    const files = readdirSync(uploadDir);
    expect(files.length).toBe(before + 1);
    const row = await db.attachment.findFirstOrThrow({ where: { id: attachment.id } });
    expect(row.storedName).toMatch(/^[0-9a-f-]{36}\.png$/);
  });

  it("rejeita .pdf cujo conteúdo não é PDF (ex.: executável) → 400", async () => {
    const t = await newTicket();
    const res = await upload(cookies.reqA, t.id, "evil.pdf", Buffer.from("MZ\x90\x00 executavel"), "application/pdf");
    expect(res.status).toBe(400);
  });

  it("rejeita extensão não permitida → 400", async () => {
    const t = await newTicket();
    expect((await upload(cookies.reqA, t.id, "script.sh", Buffer.from("echo oi"))).status).toBe(400);
  });

  it("rejeita arquivo de 11 MB → 413", async () => {
    const t = await newTicket();
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await upload(cookies.reqA, t.id, "grande.png", big)).status).toBe(413);
  });

  it("anexo em chamado alheio → 404", async () => {
    const t = await newTicket();
    expect((await upload(cookies.reqB, t.id, "a.png", PNG)).status).toBe(404);
  });

  it("download devolve os bytes com nosniff e como anexo; outro usuário → 404", async () => {
    const t = await newTicket();
    const { attachment } = await (await upload(cookies.reqA, t.id, "foto.png", PNG, "image/png")).json();
    const res = await call(DOWNLOAD, "GET", { cookie: cookies.reqA, params: { id: t.id, attachmentId: attachment.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    const other = await call(DOWNLOAD, "GET", { cookie: cookies.reqB, params: { id: t.id, attachmentId: attachment.id } });
    expect(other.status).toBe(404);
    expect(readFileSync(join(uploadDir, (await db.attachment.findFirstOrThrow()).storedName)).length).toBe(PNG.length);
  });
});
