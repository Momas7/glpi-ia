import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { registerHandler, scheduleJob, stopQueue } from "@/lib/queue";
import { autoCloseResolved } from "@/modules/tickets";

async function main() {
  getConfig(); // falha cedo se o ambiente estiver inválido
  await registerHandler("system.ping", async (data) => {
    logger.info({ data }, "system.ping recebido");
  });
  await registerHandler("tickets.auto_close", async () => {
    await autoCloseResolved();
  });
  await scheduleJob("tickets.auto_close", "0 * * * *"); // de hora em hora
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
