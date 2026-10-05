import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { registerHandler, scheduleJob, stopQueue } from "@/lib/queue";
import { registerAiJobs } from "@/modules/ai";
import { registerWebhookQueues } from "@/modules/integrations";
import { scanSla } from "@/modules/sla";
import { autoCloseResolved } from "@/modules/tickets";

async function main() {
  const config = getConfig(); // falha cedo se o ambiente estiver inválido
  if (!config.N8N_WEBHOOK_URL) {
    logger.warn("N8N_WEBHOOK_URL não definida: avisos só vão para o log e links de redefinição de senha não chegam a ninguém");
  }
  await registerHandler("system.ping", async (data) => {
    logger.info({ data }, "system.ping recebido");
  });
  await registerWebhookQueues();
  await registerHandler("tickets.auto_close", async () => {
    await autoCloseResolved();
  });
  await scheduleJob("tickets.auto_close", "0 * * * *"); // de hora em hora
  await registerHandler("sla.scan", async () => {
    await scanSla();
  });
  await scheduleJob("sla.scan", "*/5 * * * *"); // a cada 5 minutos
  await registerAiJobs();
  logger.info("worker iniciado");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "encerrando worker");
    await stopQueue();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "falha ao iniciar o worker");
  process.exit(1);
});
