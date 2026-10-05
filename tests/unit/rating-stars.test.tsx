// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { RatingStars } = await import("@/components/RatingStars");
const { RatingFields } = await import("@/components/RatingBox");
const { LateRating } = await import("@/components/RatingBox");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ rating: {} }), { status: 200 }));
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ onChange }: { onChange: (v: number) => void }) {
  const [v, setV] = useState(0);
  return (
    <RatingStars
      value={v}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
    />
  );
}

describe("RatingStars", () => {
  it("cinco opções de rádio com rótulo, selecionáveis por clique", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radiogroup", { name: "Nota do atendimento" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "4 estrelas" }));
    expect(onChange).toHaveBeenCalledWith(4);
    expect(screen.getByRole("radio", { name: "4 estrelas" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "1 estrela" })).toBeTruthy();
  });

  it("as setas do teclado mudam a nota dentro de 1 a 5", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "5 estrelas" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "5 estrelas" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(screen.getByRole("radio", { name: "5 estrelas" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByRole("radio", { name: "1 estrela" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "1 estrela" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});

describe("RatingFields e LateRating", () => {
  it("o campo de comentário é texto puro e limitado a 1000 caracteres", () => {
    render(<RatingFields stars={0} comment="" onStars={() => {}} onComment={() => {}} />);
    const box = screen.getByLabelText("Comentário (opcional)") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(1000);
  });

  it("avaliar depois: sem nota o botão fica desabilitado; com nota envia stars e comment", async () => {
    render(<LateRating ticketId="t1" />);
    const send = screen.getByRole("button", { name: "Enviar avaliação" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "5 estrelas" }));
    fireEvent.change(screen.getByLabelText("Comentário (opcional)"), { target: { value: "Rápido e educado" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar avaliação" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/t1/rating");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ stars: 5, comment: "Rápido e educado" });
  });

  it("erro 409 da API aparece como alerta", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Este chamado já foi avaliado." }), { status: 409 }));
    render(<LateRating ticketId="t1" />);
    fireEvent.click(screen.getByRole("radio", { name: "3 estrelas" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar avaliação" }));
    expect((await screen.findByRole("alert")).textContent).toContain("já foi avaliado");
  });
});
