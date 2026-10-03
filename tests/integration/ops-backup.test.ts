import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { parseBackupState } from "@/modules/system/backup";

let container: StartedPostgreSqlContainer;
let db: Db;
let name: string;
let backupDir: string;
let uploadsDir: string;

const RUNTIME = "podman";

beforeAll(async () => {
  container = await new PostgreSqlContainer("docker.io/pgvector/pgvector:pg16").start();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: container.getConnectionUri() }, stdio: "pipe" });
  db = createDb(container.getConnectionUri());
  name = container.getName().replace(/^\//, "");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  backupDir = mkdtempSync(join(tmpdir(), "bk-"));
  uploadsDir = mkdtempSync(join(tmpdir(), "up-"));
  mkdirSync(join(uploadsDir, "t1"), { recursive: true });
  writeFileSync(join(uploadsDir, "t1", "anexo.txt"), "conteúdo do anexo");
  await db.$executeRawUnsafe(`DELETE FROM "TicketEmbedding"`);
  await db.ticket.deleteMany();
  await db.user.deleteMany();
  const u = await db.user.create({ data: { name: "U", email: "u@x.com", role: "REQUESTER" } });
  for (let i = 0; i < 3; i++) await db.ticket.create({ data: { title: `t${i}`, description: "d", requesterId: u.id } });
  const t = await db.ticket.findFirstOrThrow();
  const zero = `[${new Array(768).fill(0).join(",")}]`;
  await db.$executeRaw`INSERT INTO "TicketEmbedding" ("ticketId","contentHash","embedding") VALUES (${t.id}, 'h', ${zero}::vector)`;
});

const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  RUNTIME,
  PG_CONTAINER: name,
  PG_USER: container.getUsername(),
  PG_DB: container.getDatabase(),
  UPLOADS_DIR: uploadsDir,
  BACKUP_DIR: backupDir,
  ...extra,
});
const run = (script: string, args: string[] = [], extra: Record<string, string> = {}, input?: string) =>
  spawnSync("bash", [script, ...args], { env: env(extra), encoding: "utf8", input, timeout: 180_000 });
const state = () => JSON.parse(readFileSync(join(backupDir, "estado-backup.json"), "utf8"));
const dumps = () => readdirSync(backupDir).filter((f) => f.endsWith(".dump")).sort();
const ticketCount = () => db.ticket.count();

describe("backup.sh", () => {
  it("gera o dump e o tar dos anexos, não vazios, e grava o estado de sucesso", () => {
    const r = run("scripts/backup.sh");
    expect(r.status, r.stderr).toBe(0);
    const files = readdirSync(backupDir);
    const dump = files.find((f) => f.endsWith(".dump"))!;
    const tar = files.find((f) => f.endsWith("-anexos.tar.gz"))!;
    expect(statSync(join(backupDir, dump)).size).toBeGreaterThan(1000);
    expect(statSync(join(backupDir, tar)).size).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(".partial"))).toBe(false);
    const parsed = parseBackupState(state());
    expect(parsed).toMatchObject({ lastBackupOk: true });
    expect(parsed!.lastBackupBytes).toBeGreaterThan(1000);
    expect(new Date(parsed!.lastBackupAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("com o contêiner inexistente falha, grava lastBackupOk=false com detalhe e preserva os backups antigos", () => {
    const old = join(backupDir, "chamados-20250101-020000.dump");
    writeFileSync(old, "dump antigo");
    writeFileSync(join(backupDir, "estado-backup.json"), JSON.stringify({ lastBackupAt: "2025-01-01T05:00:00.000Z", lastBackupBytes: 11, lastBackupOk: true, lastRestoreTestAt: "2025-01-02T00:00:00.000Z", lastRestoreTestOk: true }));
    const r = run("scripts/backup.sh", [], { PG_CONTAINER: "contêiner-que-não-existe" });
    expect(r.status).not.toBe(0);
    expect(existsSync(old)).toBe(true);
    expect(dumps()).toEqual(["chamados-20250101-020000.dump"]);
    const s = state();
    expect(s.lastBackupOk).toBe(false);
    expect(String(s.detail ?? "").length).toBeGreaterThan(3);
    expect(s.lastRestoreTestOk).toBe(true); // o teste de restauração anterior é preservado
    expect(readdirSync(backupDir).some((f) => f.endsWith(".partial"))).toBe(false);
  });

  it("retenção: mantém os 14 mais recentes e no máximo um por semana dos mais antigos; apaga o tar pareado", () => {
    const day = 24 * 3600 * 1000;
    const fake: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const d = new Date(Date.now() - i * day);
      const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-020000`;
      writeFileSync(join(backupDir, `chamados-${stamp}.dump`), "x");
      writeFileSync(join(backupDir, `chamados-${stamp}-anexos.tar.gz`), "x");
      fake.push(stamp);
    }
    const r = run("scripts/backup.sh");
    expect(r.status, r.stderr).toBe(0);
    const left = dumps();
    expect(left.length).toBeGreaterThanOrEqual(15);
    expect(left.length).toBeLessThanOrEqual(14 + 8);
    for (const stamp of fake.slice(0, 13)) expect(left).toContain(`chamados-${stamp}.dump`); // os 13 mais novos + o novo = 14
    const tars = readdirSync(backupDir).filter((f) => f.endsWith("-anexos.tar.gz"));
    expect(tars.length).toBe(left.length); // nenhum tar órfão e nenhum dump sem tar
    expect(left.some((f) => f === `chamados-${fake[19]}.dump`)).toBe(left.includes(`chamados-${fake[19]}.dump`));
  });
});

describe("restore-test.sh", () => {
  it("restaura o último backup num banco descartável, confere as contagens, grava o resultado e remove o contêiner", () => {
    expect(run("scripts/backup.sh").status).toBe(0);
    const r = run("scripts/restore-test.sh");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const s = parseBackupState(state());
    expect(s?.lastRestoreTestOk).toBe(true);
    expect(s?.lastBackupOk).toBe(true);
    expect(new Date(s!.lastRestoreTestAt!).getTime()).toBeGreaterThan(Date.now() - 120_000);
    const leftovers = execFileSync(RUNTIME, ["ps", "-a", "--filter", "name=chamados-restore-test", "--format", "{{.Names}}"], { encoding: "utf8" }).trim();
    expect(leftovers).toBe("");
  });

  it("dump corrompido: o teste falha, grava lastRestoreTestOk=false e sai com erro (e ainda limpa o contêiner)", () => {
    expect(run("scripts/backup.sh").status).toBe(0);
    const good = dumps()[0];
    const bad = join(backupDir, "chamados-99991231-235959.dump");
    writeFileSync(bad, readFileSync(join(backupDir, good)));
    truncateSync(bad, Math.floor(statSync(bad).size / 2));
    const r = run("scripts/restore-test.sh");
    expect(r.status).not.toBe(0);
    const s = state();
    expect(s.lastRestoreTestOk).toBe(false);
    expect(s.lastBackupOk).toBe(true);
    const leftovers = execFileSync(RUNTIME, ["ps", "-a", "--filter", "name=chamados-restore-test", "--format", "{{.Names}}"], { encoding: "utf8" }).trim();
    expect(leftovers).toBe("");
  });

  it("sem nenhum backup falha com mensagem clara", () => {
    const r = run("scripts/restore-test.sh");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/nenhum backup/i);
  });
});

describe("restore.sh", () => {
  it("sem confirmação não altera o banco", async () => {
    expect(run("scripts/backup.sh").status).toBe(0);
    const before = await ticketCount();
    await db.ticket.deleteMany({ where: { title: "t0" } });
    const dump = join(backupDir, dumps()[0]);
    const r = run("scripts/restore.sh", [dump], {}, "nao\n");
    expect(r.status).not.toBe(0);
    expect(await ticketCount()).toBe(before - 1);
  });

  it("com --yes restaura o banco para o estado do backup", async () => {
    expect(run("scripts/backup.sh").status).toBe(0);
    const before = await ticketCount();
    await db.ticket.deleteMany({ where: { title: "t0" } });
    const dump = join(backupDir, dumps()[0]);
    const r = run("scripts/restore.sh", ["--yes", dump]);
    expect(r.status, r.stderr).toBe(0);
    expect(await ticketCount()).toBe(before);
  });

  it("sem argumentos lista os backups disponíveis", () => {
    expect(run("scripts/backup.sh").status).toBe(0);
    const r = run("scripts/restore.sh");
    expect(r.stdout).toMatch(/chamados-\d{8}-\d{6}\.dump/);
  });
});
