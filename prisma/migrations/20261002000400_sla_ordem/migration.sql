-- Ordem "vence primeiro": só chamados ativos e não pausados têm chave de ordenação.
-- Coluna gerada pelo Postgres (sempre coerente, inclusive para chamados antigos); a aplicação só lê.
ALTER TABLE "Ticket" ADD COLUMN "slaSortDue" TIMESTAMP(3)
  GENERATED ALWAYS AS (
    CASE WHEN status NOT IN ('RESOLVED'::"TicketStatus", 'CLOSED'::"TicketStatus") AND "pausedAt" IS NULL
         THEN "resolutionDue" END
  ) STORED;

CREATE INDEX "Ticket_slaSortDue_idx" ON "Ticket"("slaSortDue");
