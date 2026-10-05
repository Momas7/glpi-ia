// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { AiDuplicatesCard } = await import("@/components/AiDuplicatesCard");

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(json({ ok: true }));
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const suggestion = {
  id: "s1",
  candidates: [
    { id: "t9", number: 42, title: "Internet caiu no prédio", status: "OPEN", similarity: 0.93, canOpen: true },
    { id: "t8", number: 40, title: "Sem rede no 2º andar", status: "PENDING", similarity: 0.87, canOpen: false },
  ],
};

describe("AiDuplicatesCard", () => {
  it("lista os candidatos com número, título, estado e porcentagem", () => {
    render(<AiDuplicatesCard ticketId="t1" suggestion={suggestion} />);
    expect(screen.getByText("Possíveis duplicados")).toBeTruthy();
    expect(screen.getByText(/93%/)).toBeTruthy();
    expect(screen.getByText(/87%/)).toBeTruthy();
    expect(screen.getByText("Em andamento")).toBeTruthy();
    expect(screen.getByText("Pendente")).toBeTruthy();
  });

  it("só vira link o chamado que o técnico pode abrir", () => {
    render(<AiDuplicatesCard ticketId="t1" suggestion={suggestion} />);
    expect(screen.getByRole("link", { name: /#42/ }).getAttribute("href")).toBe("/tickets/t9");
    expect(screen.queryByRole("link", { name: /#40/ })).toBeNull();
    expect(screen.getByText(/#40/)).toBeTruthy();
  });

  it("Não é duplicado envia dismiss e atualiza a página", async () => {
    render(<AiDuplicatesCard ticketId="t1" suggestion={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: "Não é duplicado" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/t1/ai/duplicates");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ action: "dismiss" });
  });

  it("erro 409 aparece como alerta e não atualiza", async () => {
    fetchMock.mockResolvedValue(json({ error: "Esta sugestão já foi decidida." }, 409));
    render(<AiDuplicatesCard ticketId="t1" suggestion={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: "Não é duplicado" }));
    expect((await screen.findByRole("alert")).textContent).toContain("já foi decidida");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("título com HTML aparece como texto", () => {
    const evil = { id: "s1", candidates: [{ id: "t9", number: 1, title: "<img src=x onerror=alert(1)>", status: "OPEN", similarity: 0.9, canOpen: true }] };
    const { container } = render(<AiDuplicatesCard ticketId="t1" suggestion={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
  });
});
