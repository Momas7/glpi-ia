import { getConfig } from "@/lib/config";
import { registerHandler, scheduleJob } from "@/lib/queue";
import { AI_DETECT_QUEUE, AI_INDEX_ARTICLE_QUEUE, AI_INDEX_TICKET_QUEUE, AI_REINDEX_QUEUE, AI_TRIAGE_QUEUE } from "./enqueue";
import { detectForTicket } from "./detect";
import { indexArticle, indexTicket, reindexAll } from "./indexing";
import { cleanupAuditInputs } from "./run";
import { runTriage } from "./triage";

export const AI_AUDIT_CLEANUP_QUEUE = "ai.audit_cleanup";

/** Registra no worker os jobs de IA: triagem por chamado e limpeza diária do texto mascarado antigo. */
export async function registerAiJobs(): Promise<void> {
  await registerHandler<{ ticketId: string }>(AI_TRIAGE_QUEUE, async ({ ticketId }) => {
    await runTriage(ticketId);
  });
  await registerHandler<{ ticketId: string }>(AI_DETECT_QUEUE, async ({ ticketId }) => {
    await detectForTicket(ticketId);
  });
  await registerHandler<{ articleId: string }>(AI_INDEX_ARTICLE_QUEUE, async ({ articleId }) => {
    await indexArticle(articleId);
  });
  await registerHandler<{ ticketId: string }>(AI_INDEX_TICKET_QUEUE, async ({ ticketId }) => {
    await indexTicket(ticketId);
  });
  await registerHandler(AI_REINDEX_QUEUE, async () => {
    await reindexAll();
  });
  await registerHandler(AI_AUDIT_CLEANUP_QUEUE, async () => {
    await cleanupAuditInputs(getConfig().AI_AUDIT_RETENTION_DAYS);
  });
  await scheduleJob(AI_AUDIT_CLEANUP_QUEUE, "0 3 * * *"); // todo dia às 3h
}
