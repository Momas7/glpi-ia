// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { AiDraftCard } = await import("@/components/AiDraftCard");

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ outcome: "DRAFTED" }));
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draft = {
  id: "c1",
  text: "Reinicie o ponto de acesso do andar.",
  sources: [
    { kind: "article" as const, id: "a1", title: "Wi-Fi sem conexão" },
    { kind: "ticket" as const, id: "t9", number: 42, title: "Wi-Fi caiu" },
  ],
};

const call = (i: number) => ({ url: fetchMock.mock.calls[i][0] as string, init: fetchMock.mock.calls[i][1] as RequestInit });

describe("AiDraftCard", () => {
  it("sem disponibilidade não renderiza nada", () => {
    const { container } = render(<AiDraftCard ticketId="t1" available={false} draft={null} />);
    expect(container.textContent).toBe("");
  });

  it("sem rascunho mostra o botão e, ao clicar, pede o rascunho e atualiza a página", async () => {
    render(<AiDraftCard ticketId="t1" available draft={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(call(0).url).toBe("/api/tickets/t1/ai/draft");
    expect(call(0).init.method).toBe("POST");
  });

  it.each([
    ["NO_SOURCES", "Não encontrei conhecimento relacionado"],
    ["NO_VALID_ANSWER", "não conseguiu montar uma resposta"],
    ["DISABLED", "IA está desligada"],
    ["BUDGET", "limite diário"],
  ])("resultado %s mostra a mensagem e não atualiza a página", async (outcome, text) => {
    fetchMock.mockResolvedValue(json({ outcome }));
    render(<AiDraftCard ticketId="t1" available draft={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));
    expect((await screen.findByRole("status")).textContent).toContain(text);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("erro da API aparece como alerta", async () => {
    fetchMock.mockResolvedValue(json({ error: "Erro interno." }, 500));
    render(<AiDraftCard ticketId="t1" available draft={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Erro interno.");
  });

  it("com rascunho mostra o texto editável e as fontes como links", () => {
    render(<AiDraftCard ticketId="t1" available draft={draft} />);
    expect((screen.getByLabelText("Rascunho de resposta") as HTMLTextAreaElement).value).toBe(draft.text);
    expect(screen.getByRole("link", { name: "Wi-Fi sem conexão" }).getAttribute("href")).toBe("/kb/a1");
    expect(screen.getByRole("link", { name: "Chamado #42 · Wi-Fi caiu" }).getAttribute("href")).toBe("/tickets/t9");
  });

  it("Publicar como comentário envia o texto editado como comentário público e depois descarta o rascunho", async () => {
    render(<AiDraftCard ticketId="t1" available draft={draft} />);
    fireEvent.change(screen.getByLabelText("Rascunho de resposta"), { target: { value: "Texto ajustado pelo técnico." } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar como comentário" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(call(0).url).toBe("/api/tickets/t1/comments");
    expect(JSON.parse(call(0).init.body as string)).toEqual({ body: "Texto ajustado pelo técnico.", internal: false });
    expect(call(1).url).toBe("/api/tickets/t1/ai/draft?published=1");
    expect(call(1).init.method).toBe("DELETE");
  });

  it("sem texto o botão de publicar fica desabilitado", () => {
    render(<AiDraftCard ticketId="t1" available draft={draft} />);
    fireEvent.change(screen.getByLabelText("Rascunho de resposta"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Publicar como comentário" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("falha ao publicar não descarta o rascunho", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Sem permissão." }, 403));
    render(<AiDraftCard ticketId="t1" available draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "Publicar como comentário" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Sem permissão.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Regenerar pede outro rascunho e Descartar apaga", async () => {
    render(<AiDraftCard ticketId="t1" available draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(call(0).init.method).toBe("POST");
    await vi.waitFor(() => expect((screen.getByRole("button", { name: "Descartar" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(call(1).init.method).toBe("DELETE");
  });

  it("título de fonte com HTML aparece como texto", () => {
    const evil = { ...draft, sources: [{ kind: "article" as const, id: "a1", title: "<img src=x onerror=alert(1)>" }] };
    const { container } = render(<AiDraftCard ticketId="t1" available draft={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});
