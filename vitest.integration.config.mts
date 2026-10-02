import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vitest/config";

// Podman (sem Docker): aponta o Testcontainers para o socket do usuário.
const podmanSock = `/run/user/${process.getuid?.()}/podman/podman.sock`;
const containerEnv: Record<string, string> =
  !process.env.DOCKER_HOST && fs.existsSync(podmanSock)
    ? { DOCKER_HOST: `unix://${podmanSock}`, TESTCONTAINERS_RYUK_DISABLED: "true" }
    : {};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: containerEnv,
  },
});
