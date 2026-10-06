import { describe, expect, it } from "vitest";
import { formatUsdTick } from "@/components/dashboard/format";

describe("formatUsdTick (eixo do custo por dia)", () => {
  it("mostra valores de frações de centavo em vez de 0.00", () => {
    expect(formatUsdTick(0.0001)).toBe("0,0001");
    expect(formatUsdTick(0.000075)).toBe("0,000075");
  });

  it("valores maiores ficam curtos", () => {
    expect(formatUsdTick(0)).toBe("0");
    expect(formatUsdTick(0.5)).toBe("0,5");
    expect(formatUsdTick(12.345)).toBe("12");
  });
});
