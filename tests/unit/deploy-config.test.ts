import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("configuração de deploy", () => {
  const compose = read("docker-compose.yml");

  it("não publica o Postgres em todas as interfaces", () => {
    expect(compose).not.toMatch(/-\s*"5432:5432"/);
    expect(compose).toMatch(/127\.0\.0\.1:5432:5432/);
  });

  it("publica o web só em 127.0.0.1 (atrás de proxy), não em todas as interfaces", () => {
    expect(compose).not.toMatch(/-\s*"3000:3000"/);
    expect(compose).toMatch(/127\.0\.0\.1:3000:3000/);
  });

  it("repassa a configuração do n8n aos containers web e worker", () => {
    expect(compose).toMatch(/N8N_WEBHOOK_URL: \$\{N8N_WEBHOOK_URL:-\}/);
    expect(compose).toMatch(/N8N_WEBHOOK_SECRET: \$\{N8N_WEBHOOK_SECRET:-\}/);
  });

  it("repassa a configuração de IA ao ambiente comum de web e worker", () => {
    // O bloco `&app-env` é compartilhado por web e worker (`*app-env`).
    expect(compose).toMatch(/worker:[\s\S]*environment: \*app-env/);
    for (const name of ["AI_ENABLED", "LLM_PROVIDER", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_DAILY_BUDGET", "AI_TRIAGE_MIN_CONFIDENCE", "AI_AUDIT_RETENTION_DAYS", "AI_MODEL_TRIAGE"]) {
      expect(compose, name).toMatch(new RegExp(`${name}: \\$\\{${name}:-`));
    }
    expect(compose).toMatch(/LLM_PROVIDER: \$\{LLM_PROVIDER:-fake\}/);
  });

  it("não traz a senha do banco fixa no repositório", () => {
    expect(compose).not.toMatch(/glpi:glpi@/);
    expect(compose).not.toMatch(/POSTGRES_PASSWORD:\s*glpi\b/);
    expect(compose).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
  });

  it("roda os alvos web e worker como usuário não-root", () => {
    const dockerfile = read("Dockerfile");
    for (const target of ["web", "worker"]) {
      const stage = dockerfile.split(new RegExp(`^FROM .* AS ${target}$`, "m"))[1] ?? "";
      const body = stage.split(/^FROM /m)[0];
      expect(body, `alvo ${target}`).toMatch(/^USER node$/m);
    }
  });

  it("versiona o .env.example sem segredo pré-preenchido", () => {
    expect(read(".gitignore")).toMatch(/^!\.env\.example$/m);
    const example = read(".env.example");
    expect(example).toMatch(/^SESSION_SECRET=$/m);
    expect(example).toMatch(/^POSTGRES_PASSWORD=$/m);
    expect(example).toMatch(/^AI_ENABLED=false$/m);
    expect(example).toMatch(/^LLM_PROVIDER=fake$/m);
    expect(example).toMatch(/^AI_AUDIT_RETENTION_DAYS=30$/m);
  });

  it("inclui o texto da licença do React Bits junto dos componentes copiados", () => {
    const license = read("src/components/bits/LICENSE.md");
    expect(license).toContain("Commons Clause");
    expect(license).toContain("David Haz");
  });
});
