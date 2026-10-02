/**
 * Cria o primeiro administrador.
 * Uso:  read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD && npm run admin:create -- --email voce@empresa.com --name "Seu Nome"
 * A senha vem só da variável ADMIN_PASSWORD (nunca de argumento de linha de comando) e passa pela política.
 */
import { createAdminUser } from "../src/modules/auth/bootstrap";
import { getDb } from "../src/lib/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg("email");
const name = arg("name");
const password = process.env.ADMIN_PASSWORD;
if (!email || !name || !password) {
  console.error("Informe --email, --name e a variável de ambiente ADMIN_PASSWORD.");
  process.exit(1);
}

try {
  const user = await createAdminUser({ email, name, password });
  console.log(`Administrador criado: ${user.email}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await getDb().$disconnect();
}
