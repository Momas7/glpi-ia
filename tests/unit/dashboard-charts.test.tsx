// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CategoryChart, TeamSlaChart, TrendChart, WeeklyChart } from "@/components/dashboard/Charts";
import { DueSoonTable, WorkloadTable } from "@/components/dashboard/Tables";

beforeAll(() => {
  // Recharts mede o contêiner com ResizeObserver, que o jsdom não tem.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(cleanup);

const EMPTY = "Sem dados no período";

describe("gráficos: estado vazio", () => {
  it("cada gráfico avisa em vez de quebrar quando não há dados", () => {
    const views = [
      <WeeklyChart key="w" data={[{ weekStart: "2026-10-05", created: 0, resolved: 0 }]} />,
      <CategoryChart key="c" data={[]} />,
      <TeamSlaChart key="t" data={[{ team: "Sistemas", percent: null, resolved: 0 }]} />,
      <TrendChart key="r" data={[{ month: "2026-10", created: 0, slaPercent: null }]} />,
    ];
    for (const view of views) {
      const { container } = render(view);
      expect(container.textContent).toContain(EMPTY);
      cleanup();
    }
  });
});

describe("gráficos: resumo acessível", () => {
  it("semanal resume os totais", () => {
    render(
      <WeeklyChart
        data={[
          { weekStart: "2026-10-05", created: 7, resolved: 4 },
          { weekStart: "2026-10-12", created: 5, resolved: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Chamados por semana: 12 criados e 6 resolvidos no período.");
  });

  it("categorias, SLA por equipe e tendência descrevem os valores", () => {
    render(<CategoryChart data={[{ category: "Rede", count: 9 }, { category: "Sem categoria", count: 2 }]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Rede: 9");
    cleanup();
    render(<TeamSlaChart data={[{ team: "Infraestrutura", percent: 80, resolved: 5 }]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Infraestrutura: 80%");
    cleanup();
    render(<TrendChart data={[{ month: "2026-09", created: 10, slaPercent: 75 }, { month: "2026-10", created: 12, slaPercent: null }]} />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toContain("2026-09: 10 chamados, 75% no SLA");
    expect(label).toContain("2026-10: 12 chamados");
  });
});

describe("tabelas", () => {
  it("'Vence primeiro' mostra número, link e se está vencido", () => {
    render(
      <DueSoonTable
        rows={[
          { id: "abc", number: 3, title: "Servidor fora", team: "Infraestrutura", assignee: null, resolutionDue: new Date("2026-10-15T14:00:00Z"), breached: true },
          { id: "def", number: 2, title: "VPN lenta", team: "Sistemas", assignee: "Ana", resolutionDue: new Date("2026-10-15T20:00:00Z"), breached: false },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Servidor fora" });
    expect(link.getAttribute("href")).toBe("/tickets/abc");
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByText("Vencido")).toBeTruthy();
    expect(screen.getByText("Em risco")).toBeTruthy();
    expect(screen.getByText("Sem responsável")).toBeTruthy();
  });

  it("listas vazias mostram mensagem", () => {
    const { container } = render(
      <>
        <DueSoonTable rows={[]} />
        <WorkloadTable rows={[]} />
      </>,
    );
    expect(container.textContent).toContain("Nada vencendo ou vencido");
    expect(container.textContent).toContain("Nenhum chamado em aberto");
  });

  it("carga por técnico mostra abertos, em risco e vencidos", () => {
    render(<WorkloadTable rows={[{ assigneeId: "a", name: "Ana", open: 3, atRisk: 1, breached: 0 }]} />);
    const row = screen.getByRole("row", { name: /Ana/ });
    expect(row.textContent).toContain("3");
  });
});
