import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/system", () => ({ checkReadiness: async () => ({ status: "ok", checks: [] }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ $queryRaw: async () => [1] }) }));
vi.mock("@/modules/auth", () => ({ SESSION_COOKIE: "s", readSessionToken: () => null, revokeSession: async () => {} }));

describe("rotas de saúde e logout devolvem X-Request-Id", () => {
  it("GET /api/health/ready", async () => {
    const { GET } = await import("@/app/api/health/ready/route");
    const res = await GET(new Request("http://app.test/api/health/ready", { headers: { "x-request-id": "req-12345678" } }));
    expect(res.headers.get("x-request-id")).toBe("req-12345678");
  });
  it("GET /api/health", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://app.test/api/health"));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
  it("POST /api/auth/logout", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    const res = await POST(new Request("http://app.test/api/auth/logout", { method: "POST" }));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
