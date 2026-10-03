// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { AiSuggestionCard } = await import("@/components/AiSuggestionCard");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ticket: {} }), { status: 200 }));
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const suggestion = {
  id: "s1",
  categoryId: "c-rede",
  categoryName: "Rede",
  priority: "HIGH" as const,
  teamId: "t-infra",
  teamName: "Infraestrutura",
  confidence: 0.9,
  current: { categoryId: "c-acessos", teamId: "t-n1" },
  options: {
    categories: [
      { id: "c-rede", name: "Rede" },
      { id: "c-acessos", name: "Acessos" },
    ],
    teams: [
      { id: "t-infra", name: "Infraestrutura" },
      { id: "t-n1", name: "Suporte N1" },
    ],
  },
};

const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);

describe("AiSuggestionCard", () => {
  it("mostra o rótulo, os valores sugeridos e a confiança", () => {
    render(<AiSuggestionCard ticketId="t1" suggestion={suggestion} />);
    expect(screen.getByText("Sugestão da IA")).toBeTruthy();
    expect(screen.getByText("Rede")).toBeTruthy();
    expect(screen.getByText("Infraestrutura")).toBeTruthy();
    expect(screen.getByText("Alta")).toBeTruthy();
    expect(screen.getByText(/90%/)).toBeTruthy();
  });

  it("Aceitar envia a ação accept e atualiza a página", async () => {
    render(<AiSuggestionCard ticketId="t1" suggestion={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/t1/ai/triage");
    expect(lastBody()).toEqual({ action: "accept" });
  });

  it("Rejeitar envia a ação reject", async () => {
    render(<AiSuggestionCard ticketId="t1" suggestion={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody()).toEqual({ action: "reject" });
  });

  it("Editar e aplicar envia os valores escolhidos nos selects", async () => {
    render(<AiSuggestionCard ticketId="t1" suggestion={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c-acessos" } });
    fireEvent.change(screen.getByLabelText("Prioridade"), { target: { value: "LOW" } });
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "t-n1" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody()).toEqual({ action: "edit", fields: { categoryId: "c-acessos", priority: "LOW", teamId: "t-n1" } });
  });

  it("Editar: sugestão sem categoria mantém a categoria atual do chamado, em vez de apagá-la", async () => {
    render(<AiSuggestionCard ticketId="t1" suggestion={{ ...suggestion, categoryId: null, categoryName: null, teamId: null, teamName: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Prioridade"), { target: { value: "LOW" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody()).toEqual({ action: "edit", fields: { categoryId: "c-acessos", priority: "LOW", teamId: "t-n1" } });
  });

  it("mostra o erro 409 da API e não atualiza a página", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "O chamado mudou desde a sugestão." }), { status: 409 }));
    render(<AiSuggestionCard ticketId="t1" suggestion={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "O chamado mudou desde a sugestão.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("nomes vindos do banco aparecem como texto, nunca como HTML", () => {
    const evil = { ...suggestion, categoryName: "<img src=x onerror=alert(1)>" };
    const { container } = render(<AiSuggestionCard ticketId="t1" suggestion={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});
