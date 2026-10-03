import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

/** O Compose repassa variáveis não definidas como "": tratar como ausentes. */
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "deve ter ao menos 32 caracteres"),
  APP_URL: z.string().url(),
  LLM_PROVIDER: z.enum(["fake", "gemini", "anthropic"]).default("fake"),
  GEMINI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL_TRIAGE: optionalString,
  AI_TRIAGE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  AI_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  EMBEDDING_PROVIDER: z.enum(["gemini"]).default("gemini"),
  AI_ENABLED: boolFromEnv.default(false),
  AI_DAILY_BUDGET: z.coerce.number().nonnegative().default(5),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  DEFAULT_INTAKE_TEAM: z.string().min(1).default("Suporte N1"),
  AUTO_CLOSE_DAYS: z.coerce.number().int().min(1).default(7),
  APP_TIMEZONE: z
    .string()
    .default("America/Sao_Paulo")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "fuso horário inválido"),
  // O Compose repassa variáveis não definidas como "": tratar como ausentes.
  N8N_WEBHOOK_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  N8N_WEBHOOK_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
}).superRefine((c, ctx) => {
  if (c.N8N_WEBHOOK_URL && (!c.N8N_WEBHOOK_SECRET || c.N8N_WEBHOOK_SECRET.length < 32)) {
    ctx.addIssue({
      code: "custom",
      path: ["N8N_WEBHOOK_SECRET"],
      message: "obrigatório, com ao menos 32 caracteres, quando N8N_WEBHOOK_URL está definida",
    });
  }
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

/** Para módulos que só precisam do banco (db, queue): falha cedo e com mensagem clara. */
export function requireDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("Configuração de ambiente inválida: DATABASE_URL não definida");
  return url;
}
