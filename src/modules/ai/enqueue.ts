import { enqueue, type PrismaTransaction } from "@/lib/queue";

export const AI_TRIAGE_QUEUE = "ai.triage";

/**
 * Enfileira a triagem do chamado na transação que o cria (rollback descarta o job).
 * Arquivo-folha: o módulo de chamados o importa direto, sem passar por `@/modules/ai`
 * (que depende de chamados), para não criar ciclo. Lê `process.env` de propósito: só liga/desliga.
 */
export async function enqueueTriage(tx: PrismaTransaction, ticketId: string): Promise<void> {
  if (process.env.AI_ENABLED !== "true") return;
  await enqueue(AI_TRIAGE_QUEUE, { ticketId }, { tx });
}
