import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  SESSION_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
};

describe("loadConfig", () => {
  it("lança listando as variáveis faltantes", () => {
    expect(() => loadConfig({})).toThrowError(/DATABASE_URL.*SESSION_SECRET|SESSION_SECRET.*DATABASE_URL/s);
  });

  it("rejeita SESSION_SECRET com menos de 32 caracteres", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "x".repeat(10) })).toThrowError(/SESSION_SECRET/);
  });

  it("converte AI_ENABLED='true' em true", () => {
    expect(loadConfig({ ...base, AI_ENABLED: "true" }).AI_ENABLED).toBe(true);
    expect(loadConfig({ ...base, AI_ENABLED: "false" }).AI_ENABLED).toBe(false);
  });

  it("aplica os valores default", () => {
    const c = loadConfig(base);
    expect(c.LLM_PROVIDER).toBe("fake");
    expect(c.EMBEDDING_PROVIDER).toBe("fake");
    expect(c.AI_ENABLED).toBe(false);
    expect(c.AI_DAILY_BUDGET).toBe(5);
    expect(c.UPLOAD_DIR).toBe("./uploads");
  });

  it("rejeita LLM_PROVIDER desconhecido", () => {
    expect(() => loadConfig({ ...base, LLM_PROVIDER: "openai" })).toThrowError(/LLM_PROVIDER/);
  });

  it("aceita os providers fake, gemini e anthropic", () => {
    for (const p of ["fake", "gemini", "anthropic"] as const) {
      expect(loadConfig({ ...base, LLM_PROVIDER: p }).LLM_PROVIDER).toBe(p);
    }
  });

  it("limiar de confiança da triagem: padrão 0.6 e valores entre 0 e 1", () => {
    expect(loadConfig(base).AI_TRIAGE_MIN_CONFIDENCE).toBe(0.6);
    expect(loadConfig({ ...base, AI_TRIAGE_MIN_CONFIDENCE: "0.8" }).AI_TRIAGE_MIN_CONFIDENCE).toBe(0.8);
    expect(() => loadConfig({ ...base, AI_TRIAGE_MIN_CONFIDENCE: "1.5" })).toThrowError(/AI_TRIAGE_MIN_CONFIDENCE/);
  });

  it("retenção do log de IA: padrão 30 dias, mínimo 1", () => {
    expect(loadConfig(base).AI_AUDIT_RETENTION_DAYS).toBe(30);
    expect(() => loadConfig({ ...base, AI_AUDIT_RETENTION_DAYS: "0" })).toThrowError(/AI_AUDIT_RETENTION_DAYS/);
  });

  it("chaves de API vazias (como o Compose repassa) viram ausentes", () => {
    const c = loadConfig({ ...base, GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "", AI_MODEL_TRIAGE: "" });
    expect(c.GEMINI_API_KEY).toBeUndefined();
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.AI_MODEL_TRIAGE).toBeUndefined();
  });

  it("EMBEDDING_PROVIDER aceita fake e gemini e recusa outros", () => {
    expect(loadConfig({ ...base, EMBEDDING_PROVIDER: "gemini" }).EMBEDDING_PROVIDER).toBe("gemini");
    expect(() => loadConfig({ ...base, EMBEDDING_PROVIDER: "openai" })).toThrowError(/EMBEDDING_PROVIDER/);
  });

  it("limiar de similaridade do RAG: padrão 0.6, entre 0 e 1", () => {
    expect(loadConfig(base).AI_RAG_MIN_SIMILARITY).toBe(0.6);
    expect(loadConfig({ ...base, AI_RAG_MIN_SIMILARITY: "0.75" }).AI_RAG_MIN_SIMILARITY).toBe(0.75);
    expect(() => loadConfig({ ...base, AI_RAG_MIN_SIMILARITY: "1.2" })).toThrowError(/AI_RAG_MIN_SIMILARITY/);
  });

  it("modelos de embedding e de rascunho", () => {
    expect(loadConfig(base).AI_EMBEDDING_MODEL).toBe("gemini-embedding-001");
    expect(loadConfig({ ...base, AI_MODEL_DRAFT: "" }).AI_MODEL_DRAFT).toBeUndefined();
    expect(loadConfig({ ...base, AI_MODEL_DRAFT: "claude-sonnet-5-5" }).AI_MODEL_DRAFT).toBe("claude-sonnet-5-5");
  });

  it("AUTO_CLOSE_DAYS tem padrão 7 e recusa valores menores que 1", () => {
    expect(loadConfig(base).AUTO_CLOSE_DAYS).toBe(7);
    expect(loadConfig({ ...base, AUTO_CLOSE_DAYS: "3" }).AUTO_CLOSE_DAYS).toBe(3);
    expect(() => loadConfig({ ...base, AUTO_CLOSE_DAYS: "0" })).toThrowError(/AUTO_CLOSE_DAYS/);
  });

  it("N8N: segredo obrigatório (≥ 32) quando a URL existe; URL precisa ser válida", () => {
    expect(() => loadConfig(base)).not.toThrow();
    expect(() => loadConfig({ ...base, N8N_WEBHOOK_URL: "http://n8n.local/webhook/x" })).toThrowError(/N8N_WEBHOOK_SECRET/);
    expect(() =>
      loadConfig({ ...base, N8N_WEBHOOK_URL: "http://n8n.local/webhook/x", N8N_WEBHOOK_SECRET: "curto" }),
    ).toThrowError(/N8N_WEBHOOK_SECRET/);
    expect(
      loadConfig({ ...base, N8N_WEBHOOK_URL: "http://n8n.local/webhook/x", N8N_WEBHOOK_SECRET: "s".repeat(32) }).N8N_WEBHOOK_URL,
    ).toBe("http://n8n.local/webhook/x");
    expect(() => loadConfig({ ...base, N8N_WEBHOOK_URL: "nao-e-url", N8N_WEBHOOK_SECRET: "s".repeat(32) })).toThrowError(/N8N_WEBHOOK_URL/);
  });

  it("N8N vazios (como o Compose repassa quando não definidos) contam como ausentes", () => {
    const c = loadConfig({ ...base, N8N_WEBHOOK_URL: "", N8N_WEBHOOK_SECRET: "" });
    expect(c.N8N_WEBHOOK_URL).toBeUndefined();
  });

  it("APP_TIMEZONE: padrão America/Sao_Paulo e fuso inválido é recusado", () => {
    expect(loadConfig(base).APP_TIMEZONE).toBe("America/Sao_Paulo");
    expect(() => loadConfig({ ...base, APP_TIMEZONE: "Marte/Olimpo" })).toThrowError(/APP_TIMEZONE/);
  });
});
