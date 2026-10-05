import { createHmac, timingSafeEqual } from "node:crypto";

/** `sha256=<hex>` de HMAC-SHA256(segredo, `${timestamp}.${corpo}`), enviado no cabeçalho X-Signature. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Confere a assinatura em tempo constante e recusa timestamps fora da tolerância (contra replay). */
export function verifySignature(input: {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > (input.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signPayload(input.secret, input.timestamp, input.body));
  const received = Buffer.from(input.signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
