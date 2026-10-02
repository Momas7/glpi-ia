import { execSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

export interface TestDb {
  url: string;
  stop(): Promise<void>;
}

/** Sobe um Postgres com pgvector e aplica as migrations. */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("docker.io/pgvector/pgvector:pg16").start();
  const url = container.getConnectionUri();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  return { url, stop: async () => void (await container.stop()) };
}
