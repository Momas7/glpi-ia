import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const scripts = ["scripts/backup.sh", "scripts/restore.sh", "scripts/restore-test.sh"];

describe("scripts de operação", () => {
  it("todos são bash estrito, sem eval, e não recebem senha por argumento", () => {
    for (const path of [...scripts, "scripts/lib/ops-common.sh"]) {
      const text = read(path);
      expect(text, path).toMatch(/^#!\/usr\/bin\/env bash$/m);
      if (path.endsWith("ops-common.sh")) continue;
      expect(text, path).toMatch(/^set -euo pipefail$/m);
      expect(text, path).not.toMatch(/\beval\b/);
      expect(text, path).not.toMatch(/PGPASSWORD|--password|-p\s*\$\{?[A-Z_]*PASS/);
    }
    expect(read("scripts/lib/ops-common.sh")).not.toMatch(/\beval\b/);
  });

  it("o backup só grava o estado de sucesso no fim e de forma atômica, e falha sem apagar backups antigos", () => {
    const backup = read("scripts/backup.sh");
    const common = read("scripts/lib/ops-common.sh");
    expect(common).toMatch(/mv -f ["']?\$tmp/); // escrita atômica do estado
    expect(backup.indexOf("apply_retention")).toBeGreaterThan(backup.indexOf("pg_dump"));
    expect(backup).toMatch(/fail\s+["']/); // caminho de falha explícito
    expect(backup).toMatch(/\.partial/); // dump parcial nunca vira backup válido
  });

  it("a restauração pede confirmação antes de tocar no banco vivo", () => {
    const restore = read("scripts/restore.sh");
    expect(restore).toMatch(/--yes/);
    expect(restore).toMatch(/restaurar/);
    expect(restore.indexOf("--yes")).toBeLessThan(restore.indexOf("pg_restore"));
  });

  it("o teste de restauração remove o contêiner descartável sempre (trap) e nunca publica porta", () => {
    const test = read("scripts/restore-test.sh");
    expect(test).toMatch(/trap [^\n]*(cleanup|rm -f)[^\n]* EXIT/);
    expect(test).not.toMatch(/\s-p\s+\d|--publish/);
    expect(test).toMatch(/lastRestoreTestOk|restore_test_ok/);
  });

  it("as unidades do systemd têm os horários combinados e Persistent=true", () => {
    expect(read("deploy/systemd/chamados-backup.timer")).toMatch(/OnCalendar=\*-\*-\* 02:00:00/);
    expect(read("deploy/systemd/chamados-restore-test.timer")).toMatch(/OnCalendar=Sun \*-\*-\* 03:30:00/);
    for (const t of ["chamados-backup", "chamados-restore-test"]) {
      expect(read(`deploy/systemd/${t}.timer`)).toMatch(/Persistent=true/);
      expect(read(`deploy/systemd/${t}.timer`)).toMatch(/WantedBy=timers\.target/);
      expect(read(`deploy/systemd/${t}.service`)).toMatch(/Type=oneshot/);
    }
    expect(read("deploy/systemd/chamados-backup.service")).toMatch(/ExecStart=.*scripts\/backup\.sh/);
    expect(read("deploy/systemd/chamados-restore-test.service")).toMatch(/ExecStart=.*scripts\/restore-test\.sh/);
  });
});
