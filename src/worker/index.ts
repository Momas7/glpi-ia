import { logger } from "@/lib/logger";
import { registerHandler, stopQueue } from "@/lib/queue";

async function main() {
  await registerHandler("system.ping", async (data) => {
    logger.info({ data }, "system.ping recebido");
  });
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
