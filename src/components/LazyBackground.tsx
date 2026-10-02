"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";

const Aurora = lazy(() => import("@/components/bits/Aurora"));

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Fundo animado (React Bits) carregado sob demanda.
 * Não renderiza nada com prefers-reduced-motion: reduce (nem no servidor).
 * Usar só em telas leves (login, dashboard), nunca em lista/detalhe de chamado.
 */
export function LazyBackground() {
  const reduceMotion = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );

  if (reduceMotion) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 opacity-60">
      <Suspense fallback={null}>
        <Aurora colorStops={["#3A29FF", "#FF94B4", "#FF3232"]} />
      </Suspense>
    </div>
  );
}
