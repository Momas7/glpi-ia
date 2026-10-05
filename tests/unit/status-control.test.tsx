// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { StatusControl } = await import("@/components/forms/StatusControl");

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

const body = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);

describe("StatusControl", () => {
  it("outras transições seguem como antes, sem pedir solução", async () => {
    render(<StatusControl ticketId="t1" next={["PENDING", "RESOLVED"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Marcar como pendente/i }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(body()).toEqual({ status: "PENDING" });
  });

  it("Marcar como resolvido abre a caixa de solução e ainda não chama a API", () => {
    render(<StatusControl ticketId="t1" next={["PENDING", "RESOLVED"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Marcar como resolvido/i }));
    expect(screen.getByLabelText("Solução")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("com menos de 10 caracteres o envio fica desabilitado", () => {
    render(<StatusControl ticketId="t1" next={["RESOLVED"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Marcar como resolvido/i }));
    fireEvent.change(screen.getByLabelText("Solução"), { target: { value: "curta" } });
    expect((screen.getByRole("button", { name: "Resolver chamado" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("com a solução preenchida envia status e resolution e atualiza a página", async () => {
    render(<StatusControl ticketId="t1" next={["RESOLVED"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Marcar como resolvido/i }));
    fireEvent.change(screen.getByLabelText("Solução"), { target: { value: "Reiniciei o serviço de spool." } });
    fireEvent.click(screen.getByRole("button", { name: "Resolver chamado" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/t1");
    expect(body()).toEqual({ status: "RESOLVED", resolution: "Reiniciei o serviço de spool." });
  });

  it("cancelar fecha a caixa sem chamar a API; erro da API aparece na tela", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Informe a solução do chamado." }), { status: 400 }));
    render(<StatusControl ticketId="t1" next={["RESOLVED"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Marcar como resolvido/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Solução")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Marcar como resolvido/i }));
    fireEvent.change(screen.getByLabelText("Solução"), { target: { value: "Reiniciei o serviço de spool." } });
    fireEvent.click(screen.getByRole("button", { name: "Resolver chamado" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Informe a solução");
  });
});
