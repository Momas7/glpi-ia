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
    expect(c.LLM_PROVIDER).toBe("gemini");
    expect(c.EMBEDDING_PROVIDER).toBe("gemini");
    expect(c.AI_ENABLED).toBe(false);
    expect(c.AI_DAILY_BUDGET).toBe(5);
    expect(c.UPLOAD_DIR).toBe("./uploads");
  });

  it("rejeita LLM_PROVIDER desconhecido", () => {
    expect(() => loadConfig({ ...base, LLM_PROVIDER: "openai" })).toThrowError(/LLM_PROVIDER/);
  });

  it("AUTO_CLOSE_DAYS tem padrão 7 e recusa valores menores que 1", () => {
    expect(loadConfig(base).AUTO_CLOSE_DAYS).toBe(7);
    expect(loadConfig({ ...base, AUTO_CLOSE_DAYS: "3" }).AUTO_CLOSE_DAYS).toBe(3);
    expect(() => loadConfig({ ...base, AUTO_CLOSE_DAYS: "0" })).toThrowError(/AUTO_CLOSE_DAYS/);
  });
});
