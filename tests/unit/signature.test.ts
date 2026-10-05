import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/modules/integrations/signature";

const secret = "s".repeat(32);
const ts = 1_790_000_000;
const body = '{"a":1}';
const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

describe("assinatura dos webhooks", () => {
  it("signPayload = HMAC-SHA256(segredo, timestamp + '.' + corpo)", () => {
    expect(signPayload(secret, ts, body)).toBe(expected);
  });

  it("verifySignature aceita a assinatura certa dentro da tolerância", () => {
    expect(verifySignature({ secret, timestamp: ts, body, signature: expected, now: ts + 10 })).toBe(true);
  });

  it("recusa corpo alterado, segredo errado, timestamp antigo e assinatura com tamanho diferente", () => {
    expect(verifySignature({ secret, timestamp: ts, body: '{"a":2}', signature: expected, now: ts })).toBe(false);
    expect(verifySignature({ secret: "x".repeat(32), timestamp: ts, body, signature: expected, now: ts })).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, body, signature: expected, now: ts + 301 })).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, body, signature: "sha256=abc", now: ts })).toBe(false);
  });
});
