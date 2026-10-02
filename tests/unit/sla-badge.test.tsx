// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SlaBadge } from "@/components/SlaBadge";

afterEach(cleanup);

describe("SlaBadge", () => {
  it.each([
    ["ok", 180, "Em dia · vence em 3 h"],
    ["at_risk", 40, "Em risco · vence em 40 min"],
    ["breached", -120, "Vencido há 2 h"],
    ["paused", null, "Pausado"],
  ] as const)("%s → %s", (state, remaining, text) => {
    const { container } = render(<SlaBadge state={state} remainingMinutes={remaining} />);
    expect(container.textContent).toBe(text);
  });

  it("não mostra nada sem prazo ou com o chamado encerrado", () => {
    for (const state of ["none", "done"] as const) {
      const { container } = render(<SlaBadge state={state} remainingMinutes={null} />);
      expect(container.textContent).toBe("");
      cleanup();
    }
  });
});
