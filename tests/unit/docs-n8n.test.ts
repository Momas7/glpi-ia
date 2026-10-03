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

  it("workflow: filtros extraem o valor do cabeçalho e cobrem respostas automáticas e listas", () => {
    const wf = JSON.parse(readFileSync("docs/n8n/email-vira-chamado.json", "utf8"));
    const filter = JSON.stringify(wf.nodes.find((n: { type: string }) => n.type === "n8n-nodes-base.if").parameters);
    expect(filter).toContain("split(':')");
    for (const h of ["auto-submitted", "precedence", "x-autoreply", "list-id"]) expect(filter.toLowerCase(), h).toContain(h);
  });

  it("workflow: falha da API não passa em silêncio (422 responde ao remetente, outros erros param a execução)", () => {
    const wf = JSON.parse(readFileSync("docs/n8n/email-vira-chamado.json", "utf8"));
    const types = wf.nodes.map((n: { type: string }) => n.type);
    expect(types).toContain("n8n-nodes-base.emailSend");
    expect(types).toContain("n8n-nodes-base.stopAndError");
    const http = wf.nodes.find((n: { type: string }) => n.type === "n8n-nodes-base.httpRequest");
    expect(http.retryOnFail).toBe(true);
    expect(http.parameters.jsonBody).toContain("E-mail: ");
  });

  it("guia: requisitos do n8n e riscos documentados", () => {
    for (const text of ["NODE_FUNCTION_ALLOW_BUILTIN", "N8N_BLOCK_ENV_ACCESS_IN_NODE", "When Last Node Finishes", "SPF", "DKIM"]) {
      expect(doc, text).toContain(text);
    }
  });

  it("o guia documenta todos os eventos e os erros da API", () => {
    for (const ev of ["ticket.created", "ticket.assigned", "ticket.status_changed", "comment.created", "sla.warning", "sla.breached", "incident.detected", "auth.invite_created", "auth.password_reset_requested"]) {
      expect(doc, ev).toContain(`\`${ev}\``);
    }
    for (const code of ["401", "403", "413", "422", "429"]) expect(doc, code).toContain(code);
  });
});
