// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AiAssistSection } from "@/components/dashboard/AiAssistSection";
import { AiUsageSection } from "@/components/dashboard/AiUsageSection";
import { CsatSection } from "@/components/dashboard/CsatSection";
import { DashboardNotes } from "@/components/dashboard/DashboardNotes";
import type { AiAssistData, AiUsageData, CsatData } from "@/modules/dashboard/ai-metrics";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(cleanup);

const csat: CsatData = {
  average: 4.25,
  count: 12,
  distribution: [
    { stars: 1, count: 0 }, { stars: 2, count: 1 }, { stars: 3, count: 1 }, { stars: 4, count: 4 }, { stars: 5, count: 6 },
  ],
  trend: [
    { month: "2026-09", average: 4.1, count: 5 },
    { month: "2026-10", average: 4.25, count: 12 },
  ],
};

const assist: AiAssistData = {
  triage: { suggested: 40, accepted: 28, edited: 6, rejected: 4, pending: 2, acceptRate: 34 / 38 },
  drafts: { generated: 9, published: 5 },
  duplicates: { suggested: 7, dismissed: 3 },
  summaries: 4,
  incidents: 2,
};

const usage: AiUsageData = {
  totals: { calls: 120, failed: 3, blocked: 1, inputTokens: 90_000, outputTokens: 12_000, costUsd: 1.2345 },
  byTask: [
    { jobType: "draft", calls: 10, failed: 0, blocked: 0, inputTokens: 20_000, outputTokens: 3000, costUsd: 0.9, p50Ms: 2100, p95Ms: 4800 },
    { jobType: "triage", calls: 100, failed: 3, blocked: 1, inputTokens: 70_000, outputTokens: 9000, costUsd: 0.3345, p50Ms: 850, p95Ms: 1900 },
  ],
  costByDay: [
    { day: "2026-10-01", costUsd: 0.5 },
    { day: "2026-10-02", costUsd: 0.7345 },
  ],
};

describe("CsatSection", () => {
  it("mostra a nota média, o total de avaliações e o resumo acessível dos gráficos", () => {
    render(<CsatSection csat={csat} />);
    expect(screen.getByText("4,3")).toBeTruthy(); // 4,25 arredonda para 4,3
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByRole("img", { name: /distribuição.*5 estrelas: 6/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /2026-10: 4,3/ })).toBeTruthy();
  });

  it("sem avaliações mostra traço e o aviso de estado vazio", () => {
    render(
      <CsatSection
        csat={{ average: null, count: 0, distribution: [1, 2, 3, 4, 5].map((stars) => ({ stars: stars as 1, count: 0 })), trend: [{ month: "2026-10", average: null, count: 0 }] }}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getAllByText("Sem avaliações no período").length).toBeGreaterThan(0);
  });
});

describe("AiAssistSection", () => {
  it("mostra a taxa de aceite da triagem e os números de rascunhos, duplicados, resumos e incidentes", () => {
    render(<AiAssistSection data={assist} />);
    const region = screen.getByRole("region", { name: "IA no atendimento" });
    expect(within(region).getByText("89%")).toBeTruthy(); // 34/38
    expect(within(region).getByText(/40 sugestões/)).toBeTruthy();
    expect(within(region).getByText(/9 gerados/)).toBeTruthy();
    expect(within(region).getByText(/5 publicados/)).toBeTruthy();
    expect(within(region).getByText(/7 sugeridos/)).toBeTruthy();
    expect(within(region).getByText(/3 ignorados/)).toBeTruthy();
    expect(within(region).getByText(/4 resumos/)).toBeTruthy();
    expect(within(region).getByText(/2 incidentes/)).toBeTruthy();
  });

  it("sem decisões a taxa de aceite aparece como traço", () => {
    render(<AiAssistSection data={{ ...assist, triage: { suggested: 0, accepted: 0, edited: 0, rejected: 0, pending: 0, acceptRate: null } }} />);
    expect(within(screen.getByRole("region", { name: "IA no atendimento" })).getByText("—")).toBeTruthy();
  });
});

describe("AiUsageSection", () => {
  it("mostra custo, chamadas, falhas e barradas e a tabela por tarefa com latência", () => {
    render(<AiUsageSection usage={usage} />);
    const region = screen.getByRole("region", { name: "Uso e custo de IA" });
    expect(within(region).getByText(/1,23/)).toBeTruthy();
    expect(within(region).getByText("120")).toBeTruthy();
    const rows = within(region).getAllByRole("row");
    const draft = rows.find((r) => r.textContent?.includes("draft"))!;
    expect(draft.textContent).toContain("2100");
    expect(draft.textContent).toContain("4800");
    expect(screen.getByRole("img", { name: /custo por dia.*2026-10-02/i })).toBeTruthy();
  });

  it("sem execuções avisa o estado vazio", () => {
    render(<AiUsageSection usage={{ totals: { calls: 0, failed: 0, blocked: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, byTask: [], costByDay: [] }} />);
    expect(screen.getAllByText("Sem execuções de IA no período").length).toBeGreaterThan(0);
  });
});

describe("DashboardNotes", () => {
  it("avisa dados de demonstração só quando existem e sempre lembra que custo e acerto são estimativas", () => {
    const { rerender } = render(<DashboardNotes hasDemoData />);
    expect(screen.getByRole("note").textContent).toContain("Dados de demonstração incluídos");
    expect(screen.getByText(/estimativas/)).toBeTruthy();
    rerender(<DashboardNotes hasDemoData={false} />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText(/estimativas/)).toBeTruthy();
  });
});
