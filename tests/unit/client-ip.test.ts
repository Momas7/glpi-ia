import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

const req = (xff?: string) => new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });

describe("clientIp", () => {
  it("com 1 proxy confiável usa a última entrada (a que o proxy acrescentou), ignorando as forjadas", () => {
    expect(clientIp(req("1.1.1.1, 2.2.2.2, 203.0.113.9"), 1)).toBe("203.0.113.9");
  });

  it("com 2 proxies confiáveis usa a penúltima entrada", () => {
    expect(clientIp(req("9.9.9.9, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
  });

  it("sem cabeçalho, ou sem proxy confiável (0), cai no balde 'unknown' em vez de confiar no cliente", () => {
    expect(clientIp(req(), 1)).toBe("unknown");
    expect(clientIp(req("1.2.3.4"), 0)).toBe("unknown");
  });

  it("entrada ausente na posição esperada vira 'unknown'", () => {
    expect(clientIp(req("1.2.3.4"), 3)).toBe("unknown");
  });
});
