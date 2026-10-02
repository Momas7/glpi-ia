import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
});

afterAll(async () => {
  await testDb?.stop();
});

beforeEach(() => {
  vi.resetModules();
  delete (globalThis as { db?: unknown }).db;
});

async function callHealth(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  const { GET } = await import("@/app/api/health/route");
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

describe("GET /api/health", () => {
  it("retorna 200 e db:up com o banco disponível", async () => {
    const { status, body } = await callHealth(testDb.url);
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", db: "up" });
  });

  it("retorna 503 e db:down quando o banco está inacessível", async () => {
    const { status, body } = await callHealth("postgresql://x:y@127.0.0.1:1/none");
    expect(status).toBe(503);
    expect(body).toEqual({ status: "degraded", db: "down" });
  });
});
