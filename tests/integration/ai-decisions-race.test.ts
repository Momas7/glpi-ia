import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

// Intercepta applyTriageFields para alterar o chamado DEPOIS da checagem de obsolescência e ANTES da transação.
const hooks = vi.hoisted(() => ({ beforeApply: undefined as undefined | (() => Promise<void>) }));
vi.mock("@/modules/tickets", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/tickets")>();
  return {
    ...mod,
    applyTriageFields: async (...args: Parameters<typeof mod.applyTriageFields>) => {
      await hooks.beforeApply?.();
      return mod.applyTriageFields(...args);
    },
  };
});

let testDb: TestDb;
let db: Db;
let ai: typeof import("@/modules/ai");
let tickets: typeof import("@/modules/tickets");
let requester: SessionUser, agent: SessionUser;
let teamInfra: string, teamN1: string;

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, AI_ENABLED: "false" });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  ai = await import("@/modules/ai");
  tickets = await import("@/modules/tickets");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  hooks.beforeApply = undefined;
  await db.auditLog.deleteMany();
  await db.aiSuggestion.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  teamInfra = (await db.team.create({ data: { name: "Infraestrutura" } })).id;
  teamN1 = (await db.team.create({ data: { name: "Suporte N1" } })).id;
  const r = await db.user.create({ data: { name: "req", email: "req@x.com", role: "REQUESTER" } });
  const a = await db.user.create({ data: { name: "agent", email: "agent@x.com", role: "AGENT" } });
  requester = { id: r.id, name: r.name, email: r.email, role: "REQUESTER", teamIds: [] };
  agent = { id: a.id, name: a.name, email: a.email, role: "AGENT", teamIds: [teamN1] };
});

describe("decisão concorrente com edição manual", () => {
  it("prioridade alterada entre a checagem e a transação: 409 e nada é sobrescrito", async () => {
    const t = await tickets.createTicket(requester, { title: "Wi-Fi", description: "caiu" });
    await db.aiSuggestion.create({
      data: {
        ticketId: t.id, kind: "TRIAGE", confidence: 0.9,
        payload: { categoryId: null, priority: "HIGH", teamId: teamInfra, basis: { categoryId: null, priority: "MEDIUM", teamId: teamN1 } },
      },
    });
    hooks.beforeApply = async () => {
      await db.ticket.update({ where: { id: t.id }, data: { priority: "LOW" } });
    };
    await expect(ai.decideSuggestion(agent, t.id, { action: "accept" })).rejects.toMatchObject({ status: 409 });
    const after = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ priority: "LOW", teamId: teamN1 });
    expect((await db.aiSuggestion.findFirstOrThrow({ where: { ticketId: t.id } })).status).toBe("PENDING");
    expect(await db.ticketEvent.count({ where: { ticketId: t.id, type: { in: ["UPDATED", "ASSIGNED"] } } })).toBe(0);
  });
});
