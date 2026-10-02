import argon2 from "argon2";

const MIN_LENGTH = 12;

// Lista curta embutida; cobre as senhas mais óbvias que passariam do tamanho mínimo.
const COMMON_PASSWORDS = new Set([
  "senha1234567",
  "senha12345678",
  "password1234",
  "password12345",
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwerty123456",
  "admin1234567",
  "mudar1234567",
  "abcdefghijkl",
  "iloveyou1234",
]);

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function validatePasswordPolicy(plain: string): PasswordPolicyResult {
  if (plain.length < MIN_LENGTH) {
    return { ok: false, reason: `A senha deve ter ao menos ${MIN_LENGTH} caracteres.` };
  }
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
    return { ok: false, reason: "Essa senha é muito comum. Escolha outra." };
  }
  return { ok: true };
}
