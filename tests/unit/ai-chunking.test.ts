import { describe, expect, it } from "vitest";
import { chunkText, contentHash } from "@/modules/ai/chunking";

describe("chunkText", () => {
  it("texto curto vira um único trecho e vazio vira nenhum", () => {
    expect(chunkText("Reinicie o roteador.")).toEqual(["Reinicie o roteador."]);
    expect(chunkText("   \n\n ")).toEqual([]);
  });

  it("texto longo é dividido em trechos de no máximo 800 caracteres", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Passo ${i + 1}: verifique a conexão do cabo e do switch.`).join(" ");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
  });

  it("prefere cortar no fim de um parágrafo", () => {
    const a = "A".repeat(500);
    const b = "B".repeat(500);
    const chunks = chunkText(`${a}\n\n${b}`, { size: 800, overlap: 0 });
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b);
  });

  it("trechos vizinhos se sobrepõem e nada do texto se perde", () => {
    const words = Array.from({ length: 400 }, (_, i) => `palavra${i}`);
    const text = words.join(" ");
    const chunks = chunkText(text, { size: 300, overlap: 60 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const w of words) expect(chunks.some((c) => c.includes(w)), w).toBe(true);
    const tail = chunks[0].slice(-30).trim().split(" ").pop()!;
    expect(chunks[1]).toContain(tail);
  });

  it("palavra gigante sem espaços ainda respeita o tamanho", () => {
    const chunks = chunkText("x".repeat(2000), { size: 800, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
  });
});

describe("contentHash", () => {
  it("é estável e muda com o texto", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
