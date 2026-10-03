// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { IncidentBanner } = await import("@/components/IncidentBanner");
const { IncidentNotice } = await import("@/components/IncidentNotice");
const { CloseIncidentButton } = await import("@/components/forms/CloseIncidentButton");

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(json({ ok: true }));
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("IncidentBanner", () => {
  it("sem incidentes não renderiza nada", () => {
    const { container } = render(<IncidentBanner incidents={[]} />);
    expect(container.textContent).toBe("");
  });

  it("mostra o título e a contagem em um alerta com link para a página de incidentes", () => {
    render(<IncidentBanner incidents={[{ id: "g1", title: "Internet fora do ar", ticketCount: 7 }]} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Incidente em andamento");
    expect(alert.textContent).toContain("7 chamados parecidos");
    expect(alert.textContent).toContain("Internet fora do ar");
    expect(screen.getByRole("link", { name: /Internet fora do ar/ }).getAttribute("href")).toBe("/incidentes");
  });

  it("com vários mostra o primeiro e quantos mais", () => {
    render(
      <IncidentBanner
        incidents={[
          { id: "g1", title: "Primeiro", ticketCount: 5 },
          { id: "g2", title: "Segundo", ticketCount: 6 },
          { id: "g3", title: "Terceiro", ticketCount: 5 },
        ]}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Primeiro");
    expect(screen.getByRole("alert").textContent).toContain("mais 2");
    expect(screen.queryByText(/Segundo/)).toBeNull();
  });

  it("título com HTML aparece como texto", () => {
    const { container } = render(<IncidentBanner incidents={[{ id: "g1", title: "<img src=x onerror=alert(1)>", ticketCount: 5 }]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("IncidentNotice", () => {
  it("avisa a equipe que o chamado é parte de um incidente", () => {
    render(<IncidentNotice notice={{ id: "g1", title: "Internet fora do ar", ticketCount: 6 }} />);
    expect(screen.getByRole("status").textContent).toContain("Parte do incidente");
    expect(screen.getByRole("status").textContent).toContain("Internet fora do ar");
    expect(screen.getByRole("status").textContent).toContain("6 chamados");
  });
});

describe("CloseIncidentButton", () => {
  it("pede confirmação e só então encerra", async () => {
    render(<CloseIncidentButton id="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar incidente" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/incidents/g1/close");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });

  it("sem confirmação não chama a API", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<CloseIncidentButton id="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar incidente" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro 409 aparece como alerta", async () => {
    fetchMock.mockResolvedValue(json({ error: "Este incidente já foi encerrado." }, 409));
    render(<CloseIncidentButton id="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar incidente" }));
    expect((await screen.findByRole("alert")).textContent).toContain("já foi encerrado");
    expect(refresh).not.toHaveBeenCalled();
  });
});
