// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SafeText } from "@/components/SafeText";

afterEach(cleanup);

describe("SafeText", () => {
  it("mostra <script> como texto literal e não cria o elemento", () => {
    const { container } = render(<SafeText value="<script>alert(1)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("mostra <img onerror> como texto e não cria o elemento", () => {
    const { container } = render(<SafeText value={"<img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("onerror=alert(1)");
  });

  it("permite negrito, itálico, código inline e listas", () => {
    const { container } = render(<SafeText value={"**forte** *ênfase* `codigo`\n\n- a\n- b"} />);
    expect(container.querySelector("strong")?.textContent).toBe("forte");
    expect(container.querySelector("em")?.textContent).toBe("ênfase");
    expect(container.querySelector("code")?.textContent).toBe("codigo");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("não cria links nem imagens a partir de Markdown (evita javascript: e rastreamento)", () => {
    const { container } = render(<SafeText value={"[clique](javascript:alert(1)) ![x](http://evil/x.png)"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
