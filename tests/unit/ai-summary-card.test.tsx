// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { AiSummaryCard } = await import("@/components/AiSummaryCard");

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(json({ outcome: "SUMMARIZED" }));
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noSummary = { available: true, commentCount: 5, summary: null };
const withSummary = { available: true, commentCount: 6, summary: { text: "A impressora travou e foi reiniciada.", commentCount: 4, newComments: 0 } };

describe("AiSummaryCard", () => {
  it("indisponível não renderiza nada", () => {
    const { container } = render(<AiSummaryCard ticketId="t1" view={{ available: false, commentCount: 0, summary: null }} />);
    expect(container.textContent).toBe("");
  });

  it("Resumir conversa pede o resumo e atualiza a página", async () => {
    render(<AiSummaryCard ticketId="t1" view={noSummary} />);
    fireEvent.click(screen.getByRole("button", { name: "Resumir conversa" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/t1/ai/summary");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });

  it("com menos de 3 comentários o botão fica desabilitado e explica quantos faltam", () => {
    render(<AiSummaryCard ticketId="t1" view={{ available: true, commentCount: 1, summary: null }} />);
    expect((screen.getByRole("button", { name: "Resumir conversa" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/faltam 2 comentários/)).toBeTruthy();
  });

  it("mostra o texto do resumo e quantos comentários ele cobre", () => {
    render(<AiSummaryCard ticketId="t1" view={withSummary} />);
    expect(screen.getByText("A impressora travou e foi reiniciada.")).toBeTruthy();
    expect(screen.getByText(/cobre 4 comentários/)).toBeTruthy();
    expect(screen.queryByText(/comentários novos/)).toBeNull();
  });

  it("avisa de comentários novos e Atualizar resumo chama a rota", async () => {
    render(<AiSummaryCard ticketId="t1" view={{ ...withSummary, summary: { ...withSummary.summary!, newComments: 2 } }} />);
    expect(screen.getByText(/há 2 comentários novos/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar resumo" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/t1/ai/summary");
  });

  it.each([
    ["TOO_SHORT", "poucos comentários"],
    ["DISABLED", "IA está desligada"],
    ["BUDGET", "limite diário"],
  ])("resultado %s mostra a mensagem e não atualiza a página", async (outcome, text) => {
    fetchMock.mockResolvedValue(json({ outcome }));
    render(<AiSummaryCard ticketId="t1" view={noSummary} />);
    fireEvent.click(screen.getByRole("button", { name: "Resumir conversa" }));
    expect((await screen.findByRole("status")).textContent).toContain(text);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("erro da API aparece como alerta", async () => {
    fetchMock.mockResolvedValue(json({ error: "Erro interno." }, 500));
    render(<AiSummaryCard ticketId="t1" view={noSummary} />);
    fireEvent.click(screen.getByRole("button", { name: "Resumir conversa" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Erro interno.");
  });

  it("texto do resumo com HTML aparece como texto", () => {
    const evil = { ...withSummary, summary: { ...withSummary.summary!, text: "<script>alert(1)</script> resumo" } };
    const { container } = render(<AiSummaryCard ticketId="t1" view={evil} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script> resumo")).toBeTruthy();
  });
});
