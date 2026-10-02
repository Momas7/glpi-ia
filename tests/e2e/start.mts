/**
 * Sobe um Postgres descartável (Testcontainers), migra, popula o seed fictício e inicia o app.
 * É o `webServer` do Playwright. Encerra o contêiner ao receber SIGTERM/SIGINT.
 */
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const PORT = process.env.E2E_PORT ?? "3100";
const podmanSock = `/run/user/${process.getuid?.()}/podman/podman.sock`;
if (!process.env.DOCKER_HOST && fs.existsSync(podmanSock)) {
  process.env.DOCKER_HOST = `unix://${podmanSock}`;
  process.env.TESTCONTAINERS_RYUK_DISABLED = "true";
}

const container = await new PostgreSqlContainer("docker.io/pgvector/pgvector:pg16").start();
const env = {
  ...process.env,
  DATABASE_URL: container.getConnectionUri(),
  SESSION_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only",
  APP_URL: `http://localhost:${PORT}`,
  SEED_DEMO_PASSWORD: "Demo-Fict1cia-Senha",
  UPLOAD_DIR: "./.e2e-uploads",
  NEXT_DIST_DIR: ".next-e2e",
};

execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
execSync("npx prisma db seed", { env, stdio: "inherit" });

const app = spawn("npx", ["next", "dev", "-p", PORT], { env, stdio: "inherit" });

const shutdown = async () => {
  app.kill("SIGTERM");
  await container.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
app.on("exit", shutdown);
