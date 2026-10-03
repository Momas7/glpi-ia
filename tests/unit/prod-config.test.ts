import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const compose = () => read("docker-compose.prod.yml");

/** Bloco de um serviço do compose (do nome até o próximo serviço de primeiro nível). */
function service(name: string): string {
  const text = compose();
  const start = text.search(new RegExp(`^  ${name}:`, "m"));
  expect(start, `serviço ${name}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/^  [a-z_]+:\s*$/m);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

describe("docker-compose.prod.yml", () => {
  it("só o Caddy publica portas, e só em 127.0.0.1", () => {
    for (const name of ["postgres", "web", "worker"]) expect(service(name), name).not.toMatch(/^\s+ports:/m);
    const caddy = service("caddy");
    expect(caddy).toMatch(/127\.0\.0\.1:\$\{HTTPS_PORT:-8443\}:443/);
    expect(caddy).toMatch(/127\.0\.0\.1:\$\{HTTP_PORT:-8080\}:80/);
    expect(compose()).not.toMatch(/-\s*"?(\d+:\d+)"?\s*$/m); // nenhuma porta sem 127.0.0.1
  });

  it("não traz senha nem segredo fixos: banco e sessão são obrigatórios e vêm do .env.prod", () => {
    expect(compose()).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
    expect(compose()).toMatch(/SESSION_SECRET:\s*\$\{SESSION_SECRET:\?/);
    expect(compose()).not.toMatch(/glpi:glpi@/);
    expect(compose()).not.toMatch(/PASSWORD:\s*[a-z0-9]{6,}\s*$/im);
  });

  it("todos os serviços reiniciam sozinhos, limitam memória e rotacionam logs", () => {
    for (const name of ["caddy", "web", "worker", "postgres"]) {
      const s = service(name);
      expect(s, `${name} restart`).toMatch(/restart:\s*unless-stopped/);
      expect(s, `${name} mem_limit`).toMatch(/mem_limit:/);
      expect(s, `${name} logging`).toMatch(/logging:\s*\*logging/);
    }
    // a rotação (10 MB × 3 arquivos) fica num único bloco reutilizado por todos os serviços
    expect(compose()).toMatch(/x-logging:\s*&logging[\s\S]*max-size:\s*"?10m"?[\s\S]*max-file:\s*"?3"?/);
  });

  it("web e postgres têm healthcheck e a ordem de subida respeita a saúde", () => {
    expect(service("postgres")).toMatch(/pg_isready/);
    expect(service("web")).toMatch(/\/api\/health/);
    expect(service("web")).toMatch(/depends_on:[\s\S]*postgres:[\s\S]*service_healthy/);
    expect(service("worker")).toMatch(/depends_on:[\s\S]*web:[\s\S]*service_healthy/);
    expect(service("caddy")).toMatch(/depends_on:[\s\S]*web:[\s\S]*service_healthy/);
  });

  it("o banco usa pgvector, volume nomeado e a rede interna; os anexos e o backup têm volume/montagem", () => {
    expect(service("postgres")).toMatch(/pgvector\/pgvector:pg16/);
    expect(service("postgres")).toMatch(/pgdata:\/var\/lib\/postgresql\/data/);
    expect(service("web")).toMatch(/uploads:\/data\/uploads/);
    expect(service("web")).toMatch(/\$\{BACKUP_DIR:-\.\/backups\}:\/backups:ro/);
    expect(service("web")).toMatch(/BACKUP_STATE_FILE:\s*\/backups\/estado-backup\.json/);
  });

  it("montagens de arquivos do host levam :z (SELinux: sem isso o contêiner não consegue ler o Caddyfile nem os backups)", () => {
    expect(service("caddy")).toMatch(/Caddyfile:\/etc\/caddy\/Caddyfile:ro,z/);
    expect(service("web")).toMatch(/:\/backups:ro,z/);
  });

  it("criar o primeiro admin usa `exec` no worker em execução e passa a senha só pelo ambiente (nunca como argumento)", () => {
    const script = JSON.parse(read("package.json")).scripts["prod:admin"] as string;
    expect(script).toMatch(/exec -e ADMIN_PASSWORD /);
    expect(script).toMatch(/admin:create/);
    expect(script).not.toMatch(/ADMIN_PASSWORD=/); // o valor não vai na linha de comando
    expect(script).not.toMatch(/run --rm/);
  });

  it("a IA nasce desligada e o app sabe que está atrás de um proxy", () => {
    expect(compose()).toMatch(/AI_ENABLED:\s*\$\{AI_ENABLED:-false\}/);
    expect(compose()).toMatch(/TRUSTED_PROXY_HOPS:\s*"?1"?/);
    expect(compose()).toMatch(/APP_URL:\s*\$\{APP_URL:-https:\/\/localhost/);
  });
});

describe("Caddyfile", () => {
  const caddy = () => read("config/caddy/Caddyfile");
  it("HTTPS local com certificado interno e proxy para o web", () => {
    expect(caddy()).toMatch(/local_certs/);
    expect(caddy()).toMatch(/tls internal/);
    expect(caddy()).toMatch(/reverse_proxy web:3000/);
  });
  it("cabeçalhos de segurança, sem HSTS (que fixaria https em todo o localhost do navegador)", () => {
    expect(caddy()).toMatch(/X-Content-Type-Options\s+nosniff/);
    expect(caddy()).toMatch(/Referrer-Policy/);
    expect(caddy()).toMatch(/X-Frame-Options\s+DENY/);
    expect(caddy()).not.toMatch(/Strict-Transport-Security/);
  });
});

describe("Dockerfile", () => {
  const docker = () => read("Dockerfile");
  it("o alvo web não copia o node_modules inteiro do build, só o necessário para migrar", () => {
    const web = docker().split(/^FROM .* AS web$/m)[1].split(/^FROM /m)[0];
    expect(web).not.toMatch(/COPY --from=build \/app\/node_modules/);
    expect(web).toMatch(/COPY --from=migrate/);
    expect(docker()).toMatch(/^FROM .* AS migrate$/m);
    expect(docker()).toMatch(/prisma@\$\{PRISMA_VERSION\}/);
  });
  it("web e worker seguem rodando como usuário não-root", () => {
    const text = docker();
    for (const target of ["web", "worker"]) {
      const stage = text.split(new RegExp(`^FROM .* AS ${target}$`, "m"))[1].split(/^FROM /m)[0];
      expect(stage, target).toMatch(/^USER node$/m);
    }
  });
});

describe(".env.prod.example e .gitignore", () => {
  it("documenta as variáveis sem nenhum segredo preenchido", () => {
    const example = read(".env.prod.example");
    for (const key of ["SESSION_SECRET", "POSTGRES_PASSWORD", "N8N_WEBHOOK_SECRET"]) expect(example).toMatch(new RegExp(`^${key}=$`, "m"));
    for (const key of ["HTTPS_PORT", "HTTP_PORT", "BACKUP_DIR", "AI_ENABLED", "LLM_PROVIDER", "GEMINI_API_KEY"]) expect(example).toMatch(new RegExp(`^#?\\s*${key}=`, "m"));
  });
  it("o .gitignore cobre o .env.prod e a pasta de backups", () => {
    const ignore = read(".gitignore");
    expect(ignore).toMatch(/^\.env\.prod$/m);
    expect(ignore).toMatch(/^\/?backups\/?$/m);
  });
});

describe("scripts/prod-init.sh", () => {
  const script = () => read("scripts/prod-init.sh");
  it("é bash estrito, protege o arquivo e nunca imprime os segredos", () => {
    expect(script()).toMatch(/^set -euo pipefail$/m);
    expect(script()).toMatch(/umask 077|chmod 600/);
    expect(script()).not.toMatch(/echo[^\n]*\$\{?(SESSION_SECRET|POSTGRES_PASSWORD|N8N_WEBHOOK_SECRET)/);
  });

  it("execução real: cria o .env.prod com 600 e segredos fortes, não sobrescreve e não imprime os valores", () => {
    const dir = mkdtempSync(join(tmpdir(), "prodinit-"));
    const target = join(dir, ".env.prod");
    const run = () => spawnSync("bash", ["scripts/prod-init.sh"], { env: { ...process.env, ENV_FILE: target }, encoding: "utf8" });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect((statSync(target).mode & 0o777).toString(8)).toBe("600");
    const env = Object.fromEntries(read(target).split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    for (const key of ["SESSION_SECRET", "POSTGRES_PASSWORD", "N8N_WEBHOOK_SECRET"]) {
      expect(env[key], key).toMatch(/^[0-9a-f]{32,}$/);
      expect(first.stdout + first.stderr).not.toContain(env[key]);
    }
    expect(env.SESSION_SECRET).not.toBe(env.N8N_WEBHOOK_SECRET);
    const before = read(target);
    const second = run();
    expect(second.status).toBe(0);
    expect(read(target)).toBe(before);
    expect(second.stdout).toMatch(/já existe/);
  });

  it("o segredo do n8n fica vazio quando o usuário não usa n8n? não: é sempre gerado (a variável só vale com a URL)", () => {
    const dir = mkdtempSync(join(tmpdir(), "prodinit2-"));
    const target = join(dir, ".env.prod");
    execFileSync("bash", ["scripts/prod-init.sh"], { env: { ...process.env, ENV_FILE: target } });
    expect(read(target)).toMatch(/^N8N_WEBHOOK_SECRET=[0-9a-f]{64}$/m);
    expect(read(target)).toMatch(/^N8N_WEBHOOK_URL=$/m);
  });
});
