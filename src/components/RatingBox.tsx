"use client";

import { useState } from "react";
import { RatingStars } from "@/components/RatingStars";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/useAction";

/** Estrelas e comentário (opcional) — usados ao confirmar o fechamento e na avaliação tardia. */
export function RatingFields({
  stars,
  comment,
  onStars,
  onComment,
}: {
  stars: number;
  comment: string;
  onStars: (n: number) => void;
  onComment: (text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">Como foi o atendimento? (opcional)</p>
      <RatingStars value={stars} onChange={onStars} />
      <Label htmlFor="rating-comment">Comentário (opcional)</Label>
      <Textarea id="rating-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => onComment(e.target.value)} />
    </div>
  );
}

/** Convite para avaliar um chamado já fechado (até 30 dias depois), uma única vez. */
export function LateRating({ ticketId }: { ticketId: string }) {
  const { run, error, pending } = useAction();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-white/10 p-4 text-sm">
      <h2 className="font-medium">Avalie o atendimento</h2>
      <RatingFields stars={stars} comment={comment} onStars={setStars} onComment={setComment} />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending || stars === 0}
          onClick={() => run(`/api/tickets/${ticketId}/rating`, "POST", { stars, ...(comment.trim() ? { comment: comment.trim() } : {}) })}
        >
          Enviar avaliação
        </Button>
        {error && (
          <span role="alert" className="text-red-400">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
