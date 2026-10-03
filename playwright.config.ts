import { defineConfig } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3100";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // O servidor de teste é o `next dev`, que compila cada página na primeira visita: em máquinas lentas (CI) o
  // login pode levar mais que os 5 s padrão.
  expect: { timeout: 20_000 },
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pt-BR",
    video: process.env.E2E_VIDEO ? { mode: "on", size: { width: 1024, height: 640 } } : "off",
    viewport: { width: 1024, height: 640 },
  },
  webServer: {
    command: "npx tsx tests/e2e/start.mts",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
