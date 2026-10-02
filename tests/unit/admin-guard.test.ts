import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));

const { assertAdminPage } = await import("@/lib/admin-guard");

const user = (role: "REQUESTER" | "AGENT" | "TEAM_LEAD" | "ADMIN") => ({ id: "u", name: "U", email: "u@x.com", role, teamIds: [] });

beforeEach(() => {
  notFound.mockClear();
});

describe("assertAdminPage", () => {
  it.each(["REQUESTER", "AGENT", "TEAM_LEAD"] as const)("responde 404 para %s", (role) => {
    expect(() => assertAdminPage(user(role))).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("deixa o ADMIN passar", () => {
    expect(() => assertAdminPage(user("ADMIN"))).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });
});
