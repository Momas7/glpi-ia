// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const { KbArticleForm } = await import("@/components/forms/KbArticleForm");
const { KbArticleActions } = await import("@/components/forms/KbArticleActions");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ article: { id: "a1" } }), { status: 200 }));
  push.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const body = (i: number) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string);
const fill = (title: string, text: string) => {
  fireEvent.change(screen.getByLabelText("Título"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Texto"), { target: { value: text } });
};

describe("KbArticleForm", () => {
  it("Salvar rascunho cria o artigo e abre a página dele", async () => {
    render(<KbArticleForm />);
    fill("Wi-Fi sem conexão", "Reinicie o roteador.");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/kb/a1"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/kb");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(body(0)).toEqual({ title: "Wi-Fi sem conexão", body: "Reinicie o roteador." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Publicar cria e em seguida publica", async () => {
    render(<KbArticleForm />);
    fill("Wi-Fi sem conexão", "Reinicie o roteador.");
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/kb/a1"));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/kb/a1");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("PATCH");
    expect(body(1)).toEqual({ published: true });
  });

  it("editar um rascunho envia PATCH com título e texto", async () => {
    render(<KbArticleForm article={{ id: "a9", title: "Antigo", body: "texto antigo", published: false }} />);
    fill("Novo título", "texto novo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/kb/a9"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/kb/a9");
    expect(body(0)).toEqual({ title: "Novo título", body: "texto novo" });
  });

  it("artigo publicado mostra 'Salvar alterações' e não oferece publicar de novo", async () => {
    render(<KbArticleForm article={{ id: "a9", title: "Antigo", body: "texto antigo", published: true }} />);
    expect(screen.queryByRole("button", { name: "Publicar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(body(0)).toEqual({ title: "Antigo", body: "texto antigo" });
  });

  it("erro da API aparece como alerta e não navega", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Dados inválidos." }), { status: 400 }));
    render(<KbArticleForm />);
    fill("ab", "x");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Dados inválidos.");
    expect(push).not.toHaveBeenCalled();
  });

  it("título com HTML fica como texto no campo, nunca vira elemento", () => {
    const { container } = render(<KbArticleForm article={{ id: "a9", title: "<img src=x onerror=alert(1)>", body: "t", published: false }} />);
    expect(container.querySelector("img")).toBeNull();
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("KbArticleActions", () => {
  it("Despublicar envia published:false e atualiza a página", async () => {
    render(<KbArticleActions id="a1" published />);
    fireEvent.click(screen.getByRole("button", { name: "Despublicar" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(body(0)).toEqual({ published: false });
  });

  it("Apagar pede confirmação e volta para a lista", async () => {
    render(<KbArticleActions id="a1" published={false} />);
    expect(screen.getByRole("button", { name: "Publicar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/kb"));
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("não apaga quando a confirmação é negada", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<KbArticleActions id="a1" published={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
