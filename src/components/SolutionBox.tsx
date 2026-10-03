"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const MIN_SOLUTION = 10;
export const MAX_SOLUTION = 4000;

/** Caixa "Solução" exibida ao marcar o chamado como resolvido: o texto vira conhecimento para os próximos. */
export function SolutionBox({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (solution: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const length = value.trim().length;
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2 rounded-lg border border-white/10 p-3">
      <Label htmlFor="solution">Solução</Label>
      <Textarea
        id="solution"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        maxLength={MAX_SOLUTION}
        placeholder="O que foi feito para resolver? (aparece para o solicitante e ajuda os próximos atendimentos)"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || length < MIN_SOLUTION} onClick={() => onSubmit(value.trim())}>
          Resolver chamado
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <span className="text-xs text-muted-foreground">
          {length}/{MIN_SOLUTION} caracteres no mínimo
        </span>
      </div>
    </div>
  );
}
