import { getConfig } from "@/lib/config";
import { registerHandler, scheduleJob } from "@/lib/queue";
import { AI_TRIAGE_QUEUE } from "./enqueue";
import { cleanupAuditInputs } from "./run";
import { runTriage } from "./triage";

export const AI_AUDIT_CLEANUP_QUEUE = "ai.audit_cleanup";

/** Registra no worker os jobs de IA: triagem por chamado e limpeza diária do texto mascarado antigo. */
export async function registerAiJobs(): Promise<void> {
  await registerHandler<{ ticketId: string }>(AI_TRIAGE_QUEUE, async ({ ticketId }) => {
    await runTriage(ticketId);
  });
  await registerHandler(AI_AUDIT_CLEANUP_QUEUE, async () => {
    await cleanupAuditInputs(getConfig().AI_AUDIT_RETENTION_DAYS);
  });
  await scheduleJob(AI_AUDIT_CLEANUP_QUEUE, "0 3 * * *"); // todo dia às 3h
}
