// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyBackground } from "@/components/LazyBackground";

// WebGL não existe no jsdom: substitui só o componente gráfico do React Bits.
vi.mock("@/components/bits/Aurora", () => ({
  default: () => <canvas data-testid="aurora" />,
}));

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LazyBackground", () => {
  it("não renderiza o fundo animado com prefers-reduced-motion: reduce", async () => {
    mockReducedMotion(true);
    render(<LazyBackground />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("aurora")).toBeNull();
  });

  it("renderiza o fundo animado, sob demanda, quando o movimento é permitido", async () => {
    mockReducedMotion(false);
    render(<LazyBackground />);
    expect(await screen.findByTestId("aurora")).toBeTruthy();
  });
});
