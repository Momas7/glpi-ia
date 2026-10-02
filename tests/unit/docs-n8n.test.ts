import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { signPayload } from "@/modules/integrations/signature";

const doc = readFileSync("docs/integracao-n8n.md", "utf8");

/** Executa o trecho `js verificar-assinatura` do guia, como o nó Code do n8n faria. */
function loadVerifier(): (args: { segredo: string; timestamp: number; corpo: string; assinatura: string; agora?: number }) => boolean {
  const match = doc.match(/```js verificar-assinatura\n([\s\S]*?)```/);
  if (!match) throw new Error("bloco js verificar-assinatura não encontrado no guia");
  return new Function("require", `${match[1]}\nreturn verificar;`)(createRequire(import.meta.url));
}

describe("guia de integração com o n8n", () => {
  const segredo = "s".repeat(64);
  const timestamp = Math.floor(Date.now() / 1000);
  const corpo = JSON.stringify({ id: "evt-1", type: "ticket.created", occurredAt: "2026-10-02T12:00:00Z", data: { number: 7 } });
  const assinatura = signPayload(segredo, timestamp, corpo);

  it("o trecho de verificação do guia aceita a assinatura gerada pelo sistema", () => {
    expect(loadVerifier()({ segredo, timestamp, corpo, assinatura })).toBe(true);
  });

  it("o trecho recusa corpo alterado e timestamp antigo", () => {
    const verificar = loadVerifier();
    expect(verificar({ segredo, timestamp, corpo: corpo.replace("7", "8"), assinatura })).toBe(false);
    expect(verificar({ segredo, timestamp, corpo, assinatura, agora: timestamp + 301 })).toBe(false);
  });

  it("o workflow de exemplo é JSON válido e chama POST /api/v1/tickets", () => {
    const wf = JSON.parse(readFileSync("docs/n8n/email-vira-chamado.json", "utf8"));
    const http = wf.nodes.find((n: { type: string }) => n.type === "n8n-nodes-base.httpRequest");
    expect(http.parameters.url).toContain("/api/v1/tickets");
    expect(http.parameters.method).toBe("POST");
  });

  it("o guia documenta todos os eventos e os erros da API", () => {
    for (const ev of ["ticket.created", "ticket.assigned", "ticket.status_changed", "comment.created", "sla.warning", "sla.breached", "auth.invite_created", "auth.password_reset_requested"]) {
      expect(doc, ev).toContain(`\`${ev}\``);
    }
    for (const code of ["401", "403", "413", "422", "429"]) expect(doc, code).toContain(code);
  });
});
