import { describe, expect, it } from "vitest";
import { readBodyLimited } from "@/lib/body";

const chunked = (chunks: number, size: number) =>
  new Request("http://x/", {
    method: "POST",
    body: new ReadableStream({
      pull(c) {
        if (chunks-- > 0) c.enqueue(new Uint8Array(size));
        else c.close();
      },
    }),
    // @ts-expect-error duplex é exigido pelo Node para corpo em stream
    duplex: "half",
  });

describe("readBodyLimited", () => {
  it("devolve os bytes quando dentro do limite", async () => {
    const r = new Request("http://x/", { method: "POST", body: "olá" });
    expect(new TextDecoder().decode(await readBodyLimited(r, 100))).toBe("olá");
  });

  it("recusa com 413 quando o content-length declarado passa do limite, sem ler o corpo", async () => {
    const r = new Request("http://x/", { method: "POST", body: "x".repeat(50) });
    await expect(readBodyLimited(r, 10)).rejects.toMatchObject({ status: 413 });
  });

  it("aborta com 413 corpo em chunks sem content-length que passa do limite", async () => {
    const r = chunked(50, 1024); // 50 KB sem content-length
    expect(r.headers.get("content-length")).toBeNull();
    await expect(readBodyLimited(r, 10 * 1024)).rejects.toMatchObject({ status: 413 });
  });
});
