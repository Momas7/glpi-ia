interface Entry {
  times: number[];
  windowMs: number;
}

const hits = new Map<string, Entry>();
const PRUNE_THRESHOLD = 5000;

function prune(now: number) {
  for (const [key, entry] of hits) {
    if (entry.times.every((t) => t <= now - entry.windowMs)) hits.delete(key);
  }
}

export function rateLimitKeyCount(): number {
  return hits.size;
}

/**
 * Limite por janela deslizante, em memória deste processo.
 * Limitação conhecida: com várias instâncias do `web` cada uma conta por si.
 * Retorna true se a tentativa é permitida (e a registra). Chaves vencidas são podadas
 * quando o mapa passa de 5000 entradas.
 */
export function checkRateLimit(key: string, limit: number, windowSec: number, now = Date.now()): boolean {
  if (hits.size > PRUNE_THRESHOLD) prune(now);
  const windowMs = windowSec * 1000;
  const entry = hits.get(key) ?? { times: [], windowMs };
  entry.windowMs = windowMs;
  entry.times = entry.times.filter((t) => t > now - windowMs);
  if (entry.times.length >= limit) {
    hits.set(key, entry);
    return false;
  }
  entry.times.push(now);
  hits.set(key, entry);
  return true;
}
