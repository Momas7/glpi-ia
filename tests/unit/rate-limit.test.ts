import { describe, expect, it } from "vitest";
import { checkRateLimit, rateLimitKeyCount } from "@/modules/auth/rate-limit";

describe("checkRateLimit", () => {
  it("permite até o limite dentro da janela e bloqueia o excedente", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k1", 3, 60, t + i)).toBe(true);
    expect(checkRateLimit("k1", 3, 60, t + 10)).toBe(false);
  });

  it("libera de novo depois que a janela passa", () => {
    const t = 2_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("k2", 3, 60, t);
    expect(checkRateLimit("k2", 3, 60, t + 1000)).toBe(false);
    expect(checkRateLimit("k2", 3, 60, t + 61_000)).toBe(true);
  });

  it("isola chaves diferentes", () => {
    const t = 3_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", 3, 60, t);
    expect(checkRateLimit("b", 3, 60, t)).toBe(true);
  });

  it("poda chaves vencidas para o mapa não crescer sem limite", () => {
    const t = 4_000_000;
    for (let i = 0; i < 6000; i++) checkRateLimit(`flood:${i}`, 3, 60, t);
    expect(rateLimitKeyCount()).toBeGreaterThanOrEqual(6000);
    checkRateLimit("depois", 3, 60, t + 120_000);
    expect(rateLimitKeyCount()).toBeLessThan(100);
  });
});
