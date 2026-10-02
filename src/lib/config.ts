import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "deve ter ao menos 32 caracteres"),
  APP_URL: z.string().url(),
  LLM_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  EMBEDDING_PROVIDER: z.enum(["gemini"]).default("gemini"),
  AI_ENABLED: boolFromEnv.default(false),
  AI_DAILY_BUDGET: z.coerce.number().nonnegative().default(5),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
});

export type Config = z.output<typeof schema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Configuração de ambiente inválida: ${problems}`);
  }
  return parsed.data;
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
