/** IP do cliente. Atrás do proxy (Caddy) o primeiro item de X-Forwarded-For é o cliente real. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
