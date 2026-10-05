import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: usa o ambiente do processo (CI, Docker)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://invalid",
  },
});
