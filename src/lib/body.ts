import { AppError } from "@/lib/errors";

/**
 * Lê o corpo da requisição respeitando um teto de bytes, mesmo sem content-length (chunked).
 * Aborta a leitura assim que o limite é passado, antes de bufferizar tudo na memória.
 */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () => new AppError(413, "Corpo da requisição maior que o limite permitido.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw tooLarge();
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
