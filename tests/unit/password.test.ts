import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/modules/auth/password";

describe("hashPassword / verifyPassword", () => {
  it("gera hash argon2id e verifica senha correta e incorreta", async () => {
    const hash = await hashPassword("Tr0ca-Isto-Aqui!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "Tr0ca-Isto-Aqui!")).toBe(true);
    expect(await verifyPassword(hash, "outra-senha-qualquer")).toBe(false);
  });

  it("não explode com hash inválido", async () => {
    expect(await verifyPassword("lixo", "x")).toBe(false);
  });
});

describe("validatePasswordPolicy", () => {
  it("rejeita senha com menos de 12 caracteres", () => {
    expect(validatePasswordPolicy("curta")).toMatchObject({ ok: false });
  });

  it.each(["senha1234567", "password1234", "123456789012"])("rejeita senha comum %s", (pw) => {
    expect(validatePasswordPolicy(pw)).toMatchObject({ ok: false });
  });

  it("aceita senha longa e incomum", () => {
    expect(validatePasswordPolicy("Tr0ca-Isto-Aqui!")).toEqual({ ok: true });
  });
});
