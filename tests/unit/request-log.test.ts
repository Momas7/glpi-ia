import { describe, expect, it, vi } from "vitest";
import { instrument, resolveRequestId } from "@/lib/request-log";

describe("resolveRequestId", () => {
  it("mantém um id seguro enviado pelo cliente", () => {
    expect(resolveRequestId("abc-123_DEF.456")).toBe("abc-123_DEF.456");
  });

  it("troca por um UUID quando falta, é curto, longo ou tem caracteres perigosos", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const bad of [null, "", "curto", "x".repeat(65), "tem espaço no meio", "com\nquebra", "<script>alert(1)</script>", "a;b=c;d=e"]) {
      expect(resolveRequestId(bad)).toMatch(uuid);
    }
  });
});

const makeLog = () => ({ info: vi.fn(), error: vi.fn() });

describe("instrument", () => {
  it("devolve X-Request-Id e registra método, rota, status e tempo", async () => {
    const log = makeLog();
    const res = await instrument(new Request("http://app.test/api/tickets?q=segredo&token=abc", { method: "POST", headers: { "x-request-id": "req-12345678" } }), async () => new Response("ok", { status: 201 }), log);
    expect(res.headers.get("x-request-id")).toBe("req-12345678");
    expect(log.info).toHaveBeenCalledTimes(1);
    const entry = log.info.mock.calls[0][0];
    expect(entry).toMatchObject({ requestId: "req-12345678", method: "POST", path: "/api/tickets", status: 201 });
    expect(typeof entry.ms).toBe("number");
  });

  it("nunca registra a query string, o corpo nem cabeçalhos de autenticação", async () => {
    const log = makeLog();
    await instrument(
      new Request("http://app.test/api/x?senha=1234&token=abc", { method: "POST", headers: { authorization: "Bearer gk_secreto", cookie: "session=zzz" }, body: JSON.stringify({ senha: "1234" }) }),
      async () => new Response("ok"),
      log,
    );
    const text = JSON.stringify(log.info.mock.calls) + JSON.stringify(log.error.mock.calls);
    expect(text).not.toMatch(/senha|token|gk_secreto|session=|1234|abc/);
  });

  it("5xx registra no nível de erro; 4xx continua informativo", async () => {
    const log = makeLog();
    await instrument(new Request("http://app.test/api/a"), async () => new Response("x", { status: 500 }), log);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toMatchObject({ status: 500, path: "/api/a" });
    await instrument(new Request("http://app.test/api/b"), async () => new Response("x", { status: 404 }), log);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("não registra as chamadas de saúde (healthcheck a cada poucos segundos), mas devolve o id", async () => {
    const log = makeLog();
    const res = await instrument(new Request("http://app.test/api/health"), async () => new Response("ok"), log);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(log.info).not.toHaveBeenCalled();
  });

  it("exceção do handler vira 500 com o id, registrada como erro, sem vazar a mensagem", async () => {
    const log = makeLog();
    const res = await instrument(new Request("http://app.test/api/c"), async () => {
      throw new Error("detalhe interno secreto");
    }, log);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.text()).not.toContain("secreto");
    expect(log.error).toHaveBeenCalled();
  });
});
