import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("boot do worker", () => {
  it("sai com código 1 e cita a variável quando a configuração é inválida", () => {
    const r = spawnSync("npx", ["tsx", "--tsconfig", "tsconfig.json", "src/worker/index.ts"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/DATABASE_URL/);
  }, 30_000); // sobe o tsx num processo filho: em máquina ocupada passa dos 5 s padrão
});
