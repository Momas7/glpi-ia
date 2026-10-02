/**
 * IP do cliente a partir do X-Forwarded-For, contando da DIREITA: a entrada à esquerda pode ser forjada
 * pelo cliente, a que o nosso proxy acrescentou ao final não. `trustedHops` é quantos proxies nossos
 * existem na frente do app (TRUSTED_PROXY_HOPS, padrão 1). Com 0, ou sem entrada, retorna "unknown".
 */
export function clientIp(req: Request, trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string {
  if (!(trustedHops >= 1)) return "unknown";
  const parts = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - trustedHops] ?? "unknown";
}
