// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// A animação usa IntersectionObserver e relógio; o componente gráfico do React Bits é trocado por texto fixo.
vi.mock("@/components/bits/CountUp", () => ({ default: ({ to }: { to: number }) => <span data-testid="countup">{to}</span> }));

const { KpiCards } = await import("@/components/dashboard/KpiCards");

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const kpis = {
  openNow: 12,
  openUnassigned: 3,
  atRisk: 2,
  breached: 1,
  slaPercent: 80,
  avgFirstResponseMinutes: 450,
  avgResolutionMinutes: 1500,
};

const card = (name: string) => screen.getByRole("group", { name });

describe("KpiCards", () => {
  it("mostra os seis cartões com os valores", () => {
    mockReducedMotion(true);
    render(<KpiCards kpis={kpis} />);
    expect(card("Abertos agora").textContent).toContain("12");
    expect(card("Abertos agora").textContent).toContain("3 sem responsável");
    expect(card("Em risco").textContent).toContain("2");
    expect(card("Vencidos").textContent).toContain("1");
    expect(card("No SLA").textContent).toContain("80%");
    expect(card("1ª resposta (média)").textContent).toContain("7 h 30 min");
    expect(card("Resolução (média)").textContent).toContain("2 dias úteis e 5 h");
  });

  it("sem dados (null) mostra '—', nunca NaN", () => {
    mockReducedMotion(true);
    render(<KpiCards kpis={{ ...kpis, slaPercent: null, avgFirstResponseMinutes: null, avgResolutionMinutes: null }} />);
    for (const name of ["No SLA", "1ª resposta (média)", "Resolução (média)"]) {
      expect(card(name).textContent).toContain("—");
      expect(card(name).textContent).not.toContain("NaN");
    }
  });

  it("com movimento reduzido o valor aparece direto, sem animação", () => {
    mockReducedMotion(true);
    render(<KpiCards kpis={kpis} />);
    expect(screen.queryAllByTestId("countup")).toHaveLength(0);
  });

  it("o HTML do servidor já traz o caminho animado (sem piscar 12 → 0 → 12 na hidratação)", () => {
    // no servidor não há window; o hook usa o snapshot do servidor
    const html = renderToString(<KpiCards kpis={kpis} />);
    expect(html).toContain('data-testid="countup"');
  });

  it("a animação é escondida de leitores de tela e o valor final fica no rótulo", async () => {
    mockReducedMotion(false);
    render(<KpiCards kpis={kpis} />);
    const abertos = card("Abertos agora");
    const number = abertos.querySelector("[aria-label='12']");
    expect(number).not.toBeNull();
    expect(number!.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("com movimento permitido os números usam a animação de contagem", async () => {
    mockReducedMotion(false);
    render(<KpiCards kpis={kpis} />);
    expect((await screen.findAllByTestId("countup")).length).toBeGreaterThanOrEqual(4);
  });
});
