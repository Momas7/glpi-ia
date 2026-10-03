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
  // Triagem por IA com o provider de mentira (determinístico, sem chave nem rede).
  AI_ENABLED: "true",
  LLM_PROVIDER: "fake",
};

execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
execSync("npx prisma db seed", { env, stdio: "inherit" });

const app = spawn("npx", ["next", "dev", "-p", PORT], { env, stdio: "inherit" });
// O worker processa jobs (a triagem por IA roda nele); sem ele a sugestão nunca aparece.
const worker = spawn("npx", ["tsx", "--tsconfig", "tsconfig.json", "src/worker/index.ts"], {
  env: { ...env, SERVICE_NAME: "worker" },
  stdio: "inherit",
});

// Aquece as rotas mais usadas (o dev server compila na primeira visita) para os testes não pagarem esse custo.
(async () => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break;
    } catch {
      /* servidor ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (const path of ["/login", "/api/auth/login", "/tickets", "/admin"]) {
    await fetch(`http://localhost:${PORT}${path}`, { redirect: "manual", method: path.startsWith("/api") ? "POST" : "GET" }).catch(() => {});
  }
})();

const shutdown = async () => {
  app.kill("SIGTERM");
  worker.kill("SIGTERM");
  await container.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
app.on("exit", shutdown);
