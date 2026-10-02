const hits = new Map<string, number[]>();

/**
 * Limite por janela deslizante, em memória deste processo.
 * Limitação conhecida: com várias instâncias do `web` cada uma conta por si.
 * Retorna true se a tentativa é permitida (e a registra).
 */
export function checkRateLimit(key: string, limit: number, windowSec: number, now = Date.now()): boolean {
  const windowStart = now - windowSec * 1000;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
