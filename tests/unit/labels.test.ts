import { describe, expect, it } from "vitest";

// Servidor em UTC: o fuso precisa estar definido ANTES de o módulo criar o formatador.
process.env.TZ = "UTC";
delete process.env.APP_TIMEZONE;
const { formatDateTime } = await import("@/lib/labels");

describe("formatDateTime", () => {
  it("mostra o horário de São Paulo mesmo com o servidor em UTC", () => {
    expect(new Date("2026-10-02T21:00:00Z").getHours()).toBe(21); // prova que o processo está em UTC
    expect(formatDateTime(new Date("2026-10-02T21:00:00Z"))).toBe("02/10/2026, 18:00");
  });
});
