import { describe, expect, it } from "vitest";
import { requireDatabaseUrl } from "@/lib/config";

describe("requireDatabaseUrl", () => {
  it("lança citando DATABASE_URL quando ausente ou vazia", () => {
    expect(() => requireDatabaseUrl({})).toThrowError(/DATABASE_URL/);
    expect(() => requireDatabaseUrl({ DATABASE_URL: "" })).toThrowError(/DATABASE_URL/);
  });

  it("devolve a URL quando definida", () => {
    expect(requireDatabaseUrl({ DATABASE_URL: "postgresql://a/b" })).toBe("postgresql://a/b");
  });
});
