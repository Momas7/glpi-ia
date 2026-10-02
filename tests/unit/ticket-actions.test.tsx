// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { TicketActions } = await import("@/components/forms/TicketActions");

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ticket: {} }), { status: 200 }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = {
  ticketId: "t1",
  canTake: false,
  canReopen: false,
  canAssign: false,
  teams: [],
  current: { teamId: null, assigneeId: null },
};

describe("TicketActions", () => {
  it("mostra 'Assumir' quando o técnico pode assumir e chama a rota take", async () => {
    render(<TicketActions {...base} canTake />);
    fireEvent.click(screen.getByRole("button", { name: "Assumir" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tickets/t1/take", expect.objectContaining({ method: "POST" })));
  });

  it("mostra 'Reabrir' e 'Confirmar fechamento' ao solicitante em Resolvido", () => {
    render(<TicketActions {...base} canReopen />);
    expect(screen.getByRole("button", { name: "Reabrir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar fechamento" })).toBeTruthy();
  });

  it("'Reabrir' sem motivo não chama a API e pede o motivo", () => {
    render(<TicketActions {...base} canReopen />);
    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Informe o motivo.");
  });

  it("'Reabrir' com motivo envia o motivo para a rota reopen", async () => {
    render(<TicketActions {...base} canReopen />);
    fireEvent.change(screen.getByLabelText("Motivo da reabertura"), { target: { value: "Voltou a falhar." } });
    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tickets/t1/reopen",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Voltou a falhar." }) }),
      ),
    );
  });

  it("sem nenhuma permissão não renderiza ações", () => {
    const { container } = render(<TicketActions {...base} />);
    expect(container.textContent).toBe("");
  });
});
