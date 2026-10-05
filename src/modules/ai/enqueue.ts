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

export const AI_INDEX_ARTICLE_QUEUE = "ai.index_article";
export const AI_INDEX_TICKET_QUEUE = "ai.index_ticket";
export const AI_REINDEX_QUEUE = "ai.reindex_all";

/** Reindexa o artigo na transação que o altera. Sem IA ligada nada é enfileirado ("Reindexar tudo" cobre depois). */
export async function enqueueIndexArticle(tx: PrismaTransaction, articleId: string): Promise<void> {
  if (process.env.AI_ENABLED !== "true") return;
  await enqueue(AI_INDEX_ARTICLE_QUEUE, { articleId }, { tx });
}

/** Reindexa (ou remove do índice) o chamado na transação que resolve, reabre ou avalia. */
export async function enqueueIndexTicket(tx: PrismaTransaction, ticketId: string): Promise<void> {
  if (process.env.AI_ENABLED !== "true") return;
  await enqueue(AI_INDEX_TICKET_QUEUE, { ticketId }, { tx });
}

export const AI_DETECT_QUEUE = "ai.detect";

/**
 * Detecta duplicados e incidentes do chamado (gera o vetor do chamado aberto, ou o remove se foi encerrado).
 * Enfileirado na criação e em toda mudança de status, na mesma transação.
 */
export async function enqueueDetect(tx: PrismaTransaction, ticketId: string): Promise<void> {
  if (process.env.AI_ENABLED !== "true") return;
  await enqueue(AI_DETECT_QUEUE, { ticketId }, { tx });
}
