"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * `true` com prefers-reduced-motion. `serverValue` é o que vale no HTML do servidor e na hidratação:
 * gráficos (só cliente) usam `true`; os cartões usam `false` para o HTML já nascer no caminho animado
 * (trocar de caminho depois da hidratação faria o número piscar).
 */
export function usePrefersReducedMotion(serverValue = true): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => serverValue,
  );
}
