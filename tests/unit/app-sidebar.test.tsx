// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/tickets";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { AppSidebar } = await import("@/components/AppSidebar");

afterEach(cleanup);

const items = [
  { href: "/tickets", label: "Chamados" },
  { href: "/tickets/new", label: "Novo chamado" },
  { href: "/admin", label: "Administração" },
];
const props = { items, userName: "Ana Souza", roleLabel: "Administrador" };

describe("AppSidebar", () => {
  it("mostra o nome do sistema, os itens, a pessoa e o botão Sair", () => {
    render(<AppSidebar {...props} />);
    expect(screen.getAllByText("Sentinela").length).toBeGreaterThan(0);
    for (const i of items) expect(screen.getAllByRole("link", { name: i.label }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ana Souza").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Administrador").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Sair" }).length).toBeGreaterThan(0);
  });

  it("marca o item da página atual (inclusive subpáginas) com aria-current", () => {
    pathname = "/tickets/abc123";
    render(<AppSidebar {...props} />);
    const current = screen.getAllByRole("link", { name: "Chamados" }).filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.length).toBeGreaterThan(0);
    const novo = screen.getAllByRole("link", { name: "Novo chamado" });
    expect(novo.every((a) => a.getAttribute("aria-current") !== "page")).toBe(true);
  });

  it("'Novo chamado' não deixa 'Chamados' marcado ao mesmo tempo", () => {
    pathname = "/tickets/new";
    render(<AppSidebar {...props} />);
    const chamados = screen.getAllByRole("link", { name: "Chamados" });
    expect(chamados.every((a) => a.getAttribute("aria-current") !== "page")).toBe(true);
  });

  it("no celular, o botão de menu abre e fecha a navegação (aria-expanded)", () => {
    pathname = "/tickets";
    render(<AppSidebar {...props} />);
    const toggle = screen.getByRole("button", { name: "Abrir menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Fechar menu" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Abrir menu" }).getAttribute("aria-expanded")).toBe("false");
  });
});
