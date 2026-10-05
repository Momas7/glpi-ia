"use client";

import type { KeyboardEvent } from "react";

const label = (n: number) => `${n} ${n === 1 ? "estrela" : "estrelas"}`;

/** Nota de 1 a 5 como grupo de rádio: clique, setas do teclado e rótulo por estrela. */
export function RatingStars({ value, onChange }: { value: number; onChange: (stars: number) => void }) {
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, value + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(1, value - 1));
    }
  }

  return (
    <div role="radiogroup" aria-label="Nota do atendimento" className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={label(n)}
          tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
          onClick={() => onChange(n)}
          onKeyDown={onKeyDown}
          className={`rounded text-2xl leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
            n <= value ? "text-amber-400" : "text-muted-foreground/50"
          }`}
        >
          <span aria-hidden="true">★</span>
        </button>
      ))}
    </div>
  );
}
