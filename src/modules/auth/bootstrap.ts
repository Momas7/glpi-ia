import { getDb } from "@/lib/db";
import { hashPassword, validatePasswordPolicy } from "./password";

/** Cria um administrador direto no banco (primeira instalação, quando ainda não há convites possíveis). */
export async function createAdminUser(input: { name: string; email: string; password: string }) {
  const policy = validatePasswordPolicy(input.password);
  if (!policy.ok) throw new Error(`Senha inválida: ${policy.reason}`);
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) {
    throw new Error(`Já existe um usuário com o e-mail ${email}.`);
  }
  return db.user.create({
    data: { name: input.name.trim(), email, role: "ADMIN", passwordHash: await hashPassword(input.password) },
  });
}
