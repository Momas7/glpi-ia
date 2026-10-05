import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBackupState, readBackupState } from "@/modules/system/backup";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const tmp = () => mkdtempSync(join(tmpdir(), "estado-"));
const valid = (over: object = {}) => ({
  lastBackupAt: hoursAgo(5),
  lastBackupBytes: 123456,
  lastBackupOk: true,
  lastRestoreTestAt: hoursAgo(30),
  lastRestoreTestOk: true,
  ...over,
});

describe("parseBackupState", () => {
  it("aceita o formato escrito pelos scripts e ignora campos desconhecidos", () => {
    const parsed = parseBackupState({ ...valid(), futuro: "x" });
    expect(parsed).toMatchObject({ lastBackupOk: true, lastBackupBytes: 123456, lastRestoreTestOk: true });
    expect(parsed).not.toHaveProperty("futuro");
  });

  it("aceita um estado sem teste de restauração ainda", () => {
    const parsed = parseBackupState({ lastBackupAt: hoursAgo(1), lastBackupBytes: 10, lastBackupOk: true });
    expect(parsed?.lastRestoreTestAt).toBeNull();
    expect(parsed?.lastRestoreTestOk).toBeNull();
  });

  it("rejeita tipos errados, campos obrigatórios faltando e lixo", () => {
    expect(parseBackupState({ ...valid(), lastBackupOk: "sim" })).toBeNull();
    expect(parseBackupState({ ...valid(), lastBackupAt: "ontem" })).toBeNull();
    expect(parseBackupState({ lastBackupAt: hoursAgo(1) })).toBeNull();
    expect(parseBackupState(null)).toBeNull();
    expect(parseBackupState("texto")).toBeNull();
    expect(parseBackupState([])).toBeNull();
  });
});

describe("readBackupState", () => {
  it("sem caminho configurado: não configurado, sem estado e sem lançar", async () => {
    const r = await readBackupState(undefined, NOW);
    expect(r).toEqual({ configured: false, state: null, stale: false, ageHours: null });
  });

  it("arquivo ausente ou ilegível: configurado, sem estado e atrasado, sem lançar", async () => {
    const r = await readBackupState(join(tmp(), "nao-existe.json"), NOW);
    expect(r).toMatchObject({ configured: true, state: null, stale: true, ageHours: null });
    const dir = tmp();
    writeFileSync(join(dir, "ruim.json"), "{ isto não é json");
    expect(await readBackupState(join(dir, "ruim.json"), NOW)).toMatchObject({ configured: true, state: null, stale: true });
  });

  it("backup de 25 h não está atrasado; de 27 h está", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.json"), JSON.stringify(valid({ lastBackupAt: hoursAgo(25) })));
    writeFileSync(join(dir, "b.json"), JSON.stringify(valid({ lastBackupAt: hoursAgo(27) })));
    const a = await readBackupState(join(dir, "a.json"), NOW);
    const b = await readBackupState(join(dir, "b.json"), NOW);
    expect(a.stale).toBe(false);
    expect(a.ageHours).toBeCloseTo(25, 1);
    expect(b.stale).toBe(true);
  });

  it("último backup com falha conta como atrasado mesmo que recente", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "f.json"), JSON.stringify(valid({ lastBackupAt: hoursAgo(1), lastBackupOk: false, detail: "pg_dump falhou" })));
    const r = await readBackupState(join(dir, "f.json"), NOW);
    expect(r.state?.lastBackupOk).toBe(false);
    expect(r.stale).toBe(true);
  });
});
