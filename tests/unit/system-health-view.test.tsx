// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SystemHealthView } from "@/components/admin/SystemHealthView";
import type { SystemOverview } from "@/modules/system";

afterEach(cleanup);

const base: SystemOverview = {
  readiness: {
    status: "ok",
    checks: [
      { name: "banco", ok: true, detail: "responde" },
      { name: "worker", ok: true, detail: "batimento há 12 s" },
    ],
  },
  queues: [
    { name: "ai.triage", pending: 3, active: 1, failed: 0, oldestPendingSeconds: 45 },
    { name: "webhook.deliver", pending: 0, active: 0, failed: 2, oldestPendingSeconds: null },
  ],
  webhooks: { delivered: 40, pending: 1, failed: 2 },
  backup: {
    configured: true,
    stale: false,
    ageHours: 5,
    state: { lastBackupAt: "2026-10-10T07:00:00.000Z", lastBackupBytes: 5_242_880, lastBackupOk: true, lastRestoreTestAt: "2026-10-05T03:30:00.000Z", lastRestoreTestOk: true },
  },
  database: { sizeBytes: 52_428_800, tickets: 215, articles: 12, vectors: 340 },
};

describe("SystemHealthView", () => {
  it("lista cada verificação com estado e detalhe", () => {
    render(<SystemHealthView overview={base} />);
    const region = screen.getByRole("region", { name: "Verificações" });
    expect(within(region).getByText("banco")).toBeTruthy();
    expect(within(region).getByText("responde")).toBeTruthy();
    expect(within(region).getByText("batimento há 12 s")).toBeTruthy();
    expect(screen.getByText(/Sistema saudável/)).toBeTruthy();
  });

  it("quando algo falha, avisa com alerta e marca o item", () => {
    const degraded = { ...base, readiness: { status: "degraded" as const, checks: [{ name: "worker", ok: false, detail: "sem batimento" }] } };
    render(<SystemHealthView overview={degraded} />);
    expect(screen.getByRole("alert").textContent).toContain("Atenção");
    expect(screen.getByText("sem batimento")).toBeTruthy();
  });

  it("filas com pendentes, em andamento, falhas e a idade do mais antigo", () => {
    render(<SystemHealthView overview={base} />);
    const region = screen.getByRole("region", { name: "Filas" });
    const row = within(region).getAllByRole("row").find((r) => r.textContent?.includes("ai.triage"))!;
    expect(row.textContent).toContain("3");
    expect(row.textContent).toContain("45 s");
    const failing = within(region).getAllByRole("row").find((r) => r.textContent?.includes("webhook.deliver"))!;
    expect(failing.textContent).toContain("2");
  });

  it("avisos ao n8n e banco de dados", () => {
    render(<SystemHealthView overview={base} />);
    expect(screen.getByText(/40 entregues/)).toBeTruthy();
    expect(screen.getByText(/2 falhos/)).toBeTruthy();
    expect(screen.getByText(/50,0 MB/)).toBeTruthy();
    expect(screen.getByText(/215 chamados/)).toBeTruthy();
  });

  it("backup em dia mostra data, tamanho e o resultado do teste de restauração", () => {
    render(<SystemHealthView overview={base} />);
    const region = screen.getByRole("region", { name: "Backup" });
    expect(within(region).getByText(/5,0 MB/)).toBeTruthy();
    expect(within(region).getByText(/Teste de restauração: passou/)).toBeTruthy();
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it("backup atrasado ou com falha gera alerta; teste de restauração falho também", () => {
    const stale = { ...base, backup: { ...base.backup, stale: true, ageHours: 40 } };
    const { rerender } = render(<SystemHealthView overview={stale} />);
    expect(within(screen.getByRole("region", { name: "Backup" })).getByRole("alert").textContent).toContain("atrasado");
    const failed = { ...base, backup: { ...base.backup, state: { ...base.backup.state!, lastRestoreTestOk: false } } };
    rerender(<SystemHealthView overview={failed} />);
    expect(within(screen.getByRole("region", { name: "Backup" })).getByText(/Teste de restauração: falhou/)).toBeTruthy();
  });

  it("backup não configurado explica como ligar", () => {
    const none = { ...base, backup: { configured: false, state: null, stale: false, ageHours: null } };
    render(<SystemHealthView overview={none} />);
    expect(within(screen.getByRole("region", { name: "Backup" })).getByText(/não configurado/i)).toBeTruthy();
  });

  it("detalhes com HTML aparecem como texto", () => {
    const evil = { ...base, readiness: { status: "ok" as const, checks: [{ name: "banco", ok: true, detail: "<img src=x onerror=alert(1)>" }] } };
    const { container } = render(<SystemHealthView overview={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});
