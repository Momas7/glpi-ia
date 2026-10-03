import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));

const { assertDashboardPage } = await import("@/lib/dashboard-guard");

const user = (role: "REQUESTER" | "AGENT" | "TEAM_LEAD" | "ADMIN") => ({ id: "u", name: "U", email: "u@x.com", role, teamIds: [] });

beforeEach(() => {
  notFound.mockClear();
});

describe("assertDashboardPage", () => {
  it.each(["REQUESTER", "AGENT"] as const)("responde 404 para %s", (role) => {
    expect(() => assertDashboardPage(user(role))).toThrow("NEXT_NOT_FOUND");
  });

  it.each(["TEAM_LEAD", "ADMIN"] as const)("deixa %s passar", (role) => {
    expect(() => assertDashboardPage(user(role))).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });
});
