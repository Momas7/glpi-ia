import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "web" },
});

/** Logger filho com id de correlação (web e worker usam o mesmo id). */
export function withCorrelation(correlationId: string) {
  return logger.child({ correlationId });
}
