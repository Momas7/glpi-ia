import { createHash } from "node:crypto";

const DEFAULT_SIZE = 800;
const DEFAULT_OVERLAP = 100;

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Procura o melhor ponto de corte em [from, to]: fim de parágrafo, depois de frase, depois espaço. */
function findCut(text: string, from: number, to: number): number {
  const window = text.slice(from, to);
  for (const sep of ["\n\n", ". ", ".\n", "\n", " "]) {
    const i = window.lastIndexOf(sep);
    if (i > 0) return from + i + sep.length;
  }
  return to;
}

/**
 * Divide o texto em trechos de até `size` caracteres, com `overlap` de sobreposição entre vizinhos
 * (para uma ideia cortada ao meio aparecer inteira em algum trecho). Nada do texto se perde.
 */
export function chunkText(input: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? DEFAULT_SIZE;
  const overlap = Math.min(opts.overlap ?? DEFAULT_OVERLAP, Math.floor(size / 2));
  const text = input.trim();
  if (text === "") return [];
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + size, text.length);
    const cut = hardEnd < text.length ? findCut(text, start + Math.floor(size / 2), hardEnd) : hardEnd;
    const chunk = text.slice(start, cut).trim();
    if (chunk) chunks.push(chunk);
    if (cut >= text.length) break;
    let next = Math.max(cut - overlap, start + 1);
    // Começa a sobreposição no início de uma palavra, não no meio dela.
    while (next < cut && !/\s/.test(text[next - 1] ?? " ")) next++;
    start = next;
  }
  return chunks;
}
