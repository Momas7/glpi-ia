# Fase 6: métricas, saúde e produção local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel de satisfação e de IA no Dashboard (com seed de demonstração marcado), página e endpoint de saúde, e pacote de produção local com HTTPS, backup diário e teste de restauração.

**Architecture:** Consultas agregadas no módulo `dashboard` (mesmo cache e escopo por equipe); módulo `system` para saúde (checks, filas, backup, avisos); `docker-compose.prod.yml` com Caddy `tls internal`; scripts de shell para backup, restauração e teste de restauração que gravam um arquivo de estado lido pela página de saúde.

**Tech Stack:** Next.js 16, Prisma 7 + Postgres/pgvector, pg-boss 12, recharts (shadcn chart), Vitest/Testcontainers/Playwright, shell (bash), Podman/Docker Compose, Caddy 2.

**Spec:** `docs/specs/2026-10-03-fase-6-operacao-design.md`. Antes de escrever código de Next, leia o guia relevante em `node_modules/next/dist/docs/` (regra do `AGENTS.md`).

## Global Constraints

- Shell: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null` em **todo** comando, inclusive os de segundo plano. Antes de cada commit rode `npm run typecheck` e `npx eslint src tests scripts`. **Nunca** use `pkill -f` com padrão que apareça no próprio comando (use o truque `[x]`). Integração (~11 min a suíte): rode só os arquivos da tarefa; suíte toda e E2E só na Task 9.
- Português do Brasil em telas, erros, commits e docs. Commits **sem** coautoria nem menção a IA como autora.
- Padrões do repo: módulo com `index.ts`; autorização só por `can()`; rotas com `withAuth`/`withAdmin`; SQL cru só parametrizado; TDD de verdade (teste visto falhar antes do código); texto de usuário sempre escapado.
- Dados de demonstração sempre `demo = true`; o painel os avisa; nada de texto real de empresa.
- Segredos nunca no repositório; scripts que criam segredos gravam arquivos com permissão 600 e não os imprimem.
- Valores: batimento do worker a cada 60 s, "vivo" se ≤ 180 s; backup "atrasado" se > 26 h; retenção 14 diários e 8 semanais; portas padrão `HTTPS_PORT=8443`, `HTTP_PORT=8080` (somente `127.0.0.1`); `BACKUP_DIR` padrão `~/backups/chamados`; estado em `$BACKUP_DIR/estado-backup.json`.
- Permissões: uso e custo de IA e a página de saúde só `ADMIN` (`admin:manage`); CSAT e "IA no atendimento" para quem tem `dashboard:view`, com o escopo de equipes de sempre.

## Review Focus

- Número errado no painel: média e distribuição do CSAT, taxa de aceite, custo e percentis calculados à mão em fixtures; escopo por equipe (líder nunca soma chamado de outra equipe); período e fuso (Task 3).
- Vazamento de custo/uso de IA para quem não é admin, ou de dados de outra equipe para o líder (Tasks 3, 5).
- `ready` mentindo: banco/vetor/migração/fila/worker caindo precisa derrubar o status; nenhum segredo, caminho de host ou texto de chamado na resposta; erros internos não vazam stack (Task 6).
- Backup que não restaura: backup, restauração e teste de restauração provados ponta a ponta contra um Postgres real; script nunca sobrescreve o banco vivo sem confirmação; estado do backup não finge sucesso quando falha (Task 9).
- Segredos: `prod-init.sh` não imprime nem versiona segredos, `.env.prod` com 600; compose sem senha fixa e só `127.0.0.1` publicado (Task 8).

---

## File Structure

Criar:
- `prisma/migrations/20261007000000_operacao/migration.sql`
- `src/modules/dashboard/ai-metrics.ts`, `src/modules/system/{health,queues,backup,overview,heartbeat,index}.ts`
- `src/app/api/health/ready/route.ts`, `src/app/(app)/admin/saude/page.tsx`
- `src/components/dashboard/{CsatSection,AiAssistSection,AiUsageSection}.tsx`
- `src/lib/request-log.ts`
- `docker-compose.prod.yml`, `config/caddy/Caddyfile`, `.env.prod.example`
- `scripts/{prod-init,backup,restore,restore-test}.sh`, `deploy/systemd/{chamados-backup,chamados-restore-test}.{service,timer}`
- `docs/operacao.md`
- Testes: indicados em cada tarefa.

Modificar: `prisma/schema.prisma`, `prisma/seed.ts`, `src/modules/dashboard/index.ts`, `src/modules/ai/draft.ts`, `src/app/api/tickets/[id]/ai/draft/route.ts`, `src/components/AiDraftCard.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/worker/index.ts`, `src/lib/http.ts`, `src/app/(app)/admin/layout.tsx`, `Dockerfile`, `.gitignore`, `README.md`, `docs/ia.md`, `docs/notes/2026-10-01-pendencias-fases-0-1.md`, `package.json`.

---

### Task 1: Modelo de dados

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20261007000000_operacao/migration.sql`; Test `tests/integration/schema-operacao.test.ts`

**Interfaces:** Produces (Prisma): `AiAuditLog.demo`, `AiSuggestion.demo`, `TicketRating.demo` (`Boolean @default(false)`); `WorkerHeartbeat { service String @id, beatAt DateTime }`.

- [ ] **Step 1: Write the failing test:** as três colunas `demo` nascem `false` e aceitam `true`; `WorkerHeartbeat` faz upsert por `service`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/schema-operacao.test.ts` → FAIL.
- [ ] **Step 3: Implement** os campos/modelo e a migração (`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, **removendo** do SQL `DROP INDEX`/`ALTER` de objetos que o Prisma não conhece: `Ticket_slaSortDue_idx`, `Ticket_title_trgm_idx`, `slaSortDue`, índices HNSW; aplicar com `npm run db:migrate`; se falhar no meio, limpe o que sobrou e `prisma migrate resolve --rolled-back`).
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(operacao): marcas de demonstração e batimento do worker`.

---

### Task 2: Seed de demonstração da IA

**Files:** Modify `prisma/seed.ts`; Test `tests/integration/seed-ai.test.ts`

**Interfaces:** Produces `seedAiDemo(db: Db): Promise<void>` (exportada de `prisma/seed.ts`, chamada por `seed()` depois do histórico): idempotente (se existir `AiAuditLog` com `demo = true`, não faz nada), determinística (RNG com semente fixa, como `seedHistory`), só age se houver chamados "Histórico N".
- Para cada chamado do histórico: `AiSuggestion` `TRIAGE` (status: ~70% `ACCEPTED`, ~15% `EDITED`, ~15% `REJECTED`; `payload` mínimo coerente; `decidedAt`), `demo = true`.
- `TicketRating` para ~55% dos chamados `CLOSED` (nota 1 a 5 com média ≈ 4,2; comentário curto em ~40%), `createdAt` após o fechamento, `demo = true`.
- Poucos `DUPLICATE` (≈6% dos chamados, ~40% dos quais `REJECTED`) e `SUMMARY` (≈4%), `demo = true`.
- 2 `IncidentGroup` `CLOSED` ligados a 5 chamados do histórico cada.
- `AiAuditLog` por chamado (triagem e embedding) e mais algumas de `draft`, `summary`, `detect`, `search`, espalhados pelos mesmos 6 meses, com `inputTokens/outputTokens`, `costUsd` (de `estimateCostUsd` com modelos plausíveis), `latencyMs` (mediana ~900 ms, cauda longa), `outcome` (≈96% OK, ≈3% FAILED, ≈1% BUDGET), `demo = true`; sem `maskedInput`.

- [ ] **Step 1: Write the failing test** (`seed-ai.test.ts`, padrão de `seed.test.ts`): depois de `seed(db)` com a senha demo, existem sugestões `TRIAGE` com `demo` e as proporções ficam nas faixas (aceite 60 a 80%); média das notas entre 3,8 e 4,6 e notas entre 1 e 5; há `AiAuditLog` em ≥ 5 meses distintos, todas `demo`, com `costUsd ≥ 0`; `IncidentGroup` encerrados = 2; segunda execução não duplica nada (contagens iguais); nenhuma linha `demo` com `maskedInput`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `seed-ai.test.ts` + `seed.test.ts` → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(operacao): histórico fictício de IA e avaliações no seed`.

---

### Task 3: Consultas de métricas

**Files:** Create `src/modules/dashboard/ai-metrics.ts`; Modify `src/modules/dashboard/index.ts`, `src/modules/ai/draft.ts`, `src/app/api/tickets/[id]/ai/draft/route.ts`, `src/components/AiDraftCard.tsx`; Test `tests/integration/dashboard-ai-metrics.test.ts`, `tests/integration/ai-draft.test.ts` (estender), `tests/unit/ai-draft-card.test.tsx` (estender)

**Interfaces:**
- Produces (`ai-metrics.ts`), todas com `Scope`/`DateRange` de `queries.ts`:
  - `queryCsat(scope, range, months: Date[], timeZone): Promise<{ average: number | null; count: number; distribution: { stars: 1|2|3|4|5; count: number }[]; trend: { month: string; average: number | null; count: number }[] }>` (`distribution` sempre com as 5 notas; `month` = `YYYY-MM` no fuso).
  - `queryAiAssist(scope, range): Promise<{ triage: { suggested; accepted; edited; rejected; pending: number; acceptRate: number | null }; drafts: { generated; published: number }; duplicates: { suggested; dismissed: number }; summaries: number; incidents: number }>` (`acceptRate` = (aceitas+editadas) / decididas, `null` sem decididas; escopo pela equipe do chamado; período pela criação da sugestão/evento; incidentes = grupos com ≥ 1 chamado do escopo, por `detectedAt`).
  - `queryAiUsage(range, months: Date[], timeZone): Promise<{ totals: { calls; failed; blocked: number; inputTokens; outputTokens: number; costUsd: number }; byTask: { jobType: string; calls; failed; blocked; inputTokens; outputTokens: number; costUsd: number; p50Ms: number | null; p95Ms: number | null }[]; costByDay: { day: string; costUsd: number }[] }>` (percentis `percentile_cont` só de `outcome = 'OK'`; `blocked` = `BUDGET`; `costByDay` pelo dia local).
  - `queryHasDemo(scope, range): Promise<boolean>`.
- `getDashboard` ganha `csat`, `aiAssist`, `hasDemoData` e, **só para `ADMIN`**, `aiUsage` (campo opcional ausente para líder); mesmo cache (a chave inclui o papel para o admin nunca vazar `aiUsage` ao líder); uso/custo é global (não depende de equipe).
- Rascunho publicado: `discardDraft(actor, ticketId, opts?: { published?: boolean })` grava `TicketEvent` `AI_DRAFT_PUBLISHED` (sem texto) quando `published`; a rota `DELETE …/ai/draft` aceita `?published=1`; `AiDraftCard` usa `?published=1` ao publicar como comentário (e sem o parâmetro ao descartar).

- [ ] **Step 1: Write the failing tests:** fixtures montadas à mão com valores conhecidos — 2 equipes, avaliações 5,4,4,2,1 numa equipe e 3 na outra (média, distribuição e tendência por mês, período por `createdAt` da nota); sugestões `TRIAGE` com 6 aceitas, 2 editadas, 2 rejeitadas, 1 pendente (taxa 80%); eventos `AI_DRAFT`/`AI_DRAFT_PUBLISHED`/`AI_SUMMARY`; duplicados sugeridos/ignorados; incidente; `AiAuditLog` com custos e latências conhecidas (p50 e p95 conferidos), `BUDGET`, `FAILED`, dia local limítrofe; **líder só soma chamados da própria equipe**, **líder não recebe `aiUsage`**, admin recebe; cache não vaza `aiUsage` entre papéis; `hasDemoData` verdadeiro só com linha demo no período; período sem dados devolve zeros e `null`s; `ai-draft.test.ts`: `discardDraft(…, { published: true })` grava o evento e sem a opção não; rota com `?published=1`; teste do cartão: publicar chama `DELETE …/ai/draft?published=1` e descartar chama sem o parâmetro.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (reaproveite `between`, `Scope`, `monthStarts`, `periodRange`).
- [ ] **Step 4: Run** os arquivos novos + `tests/integration/dashboard-*.test.ts` → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(operacao): métricas de satisfação, IA no atendimento e uso de IA`.

---

### Task 4: Seções do painel

**Files:** Create `src/components/dashboard/{CsatSection,AiAssistSection,AiUsageSection}.tsx`; Modify `src/app/(app)/dashboard/page.tsx`; Test `tests/unit/dashboard-ai-sections.test.tsx`

**Interfaces:** `CsatSection({ csat })` (cartões "Nota média" e "Avaliações"; gráfico de barras da distribuição 1 a 5 e de linha da tendência; vazio: "Sem avaliações no período"); `AiAssistSection({ data })` (cartões: taxa de aceite da triagem, rascunhos gerados/publicados, duplicados sugeridos/ignorados, resumos, incidentes; vazio claro); `AiUsageSection({ usage })` (só quando `usage` existe: cartões de custo e chamadas, gráfico de custo por dia, tabela por tarefa com tokens, custo e latência p50/p95, falhas e barradas); aviso `role="note"` "Dados de demonstração incluídos" quando `hasDemoData`; rodapé "Custo e acerto são estimativas…". Gráficos com `role="img"` e `aria-label` com os números, `usePrefersReducedMotion`, textos escapados, mesmo estilo de `Charts.tsx`.

- [ ] **Step 1: Write the failing tests** (RTL): estados vazios; valores formatados (nota "4,2", "80%", "R$"/"US$" conforme o padrão do painel de IA: dólar com `Intl`); aria-labels dos gráficos contêm os números; `AiUsageSection` não renderiza sem dados de uso; aviso de demonstração só com `hasDemoData`; nenhum texto de usuário vira HTML.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** e encaixar as seções em `dashboard/page.tsx` (a página já passa `data`; o admin recebe `usage`).
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(operacao): seções de satisfação e IA no dashboard`.

---

### Task 5: Verificação de saúde

**Files:** Create `src/modules/system/{health,heartbeat,index}.ts`, `src/app/api/health/ready/route.ts`; Modify `src/worker/index.ts`; Test `tests/integration/system-health.test.ts`, `tests/unit/worker-boot.test.ts` (se couber)

**Interfaces:**
- Produces (`heartbeat.ts`): `recordHeartbeat(service: string, db?: Db): Promise<void>` (upsert com `beatAt = now()`); `HEARTBEAT_INTERVAL_MS = 60_000`; `WORKER_STALE_SECONDS = 180`.
- Produces (`health.ts`): `type Check = { name: string; ok: boolean; detail: string }`; `checkReadiness(deps?: { db?: Db; now?: () => Date }): Promise<{ status: "ok" | "degraded"; checks: Check[] }>` com os checks `banco`, `vetor` (extensão `vector` instalada), `migracoes` (nenhuma linha de `_prisma_migrations` com `finished_at IS NULL AND rolled_back_at IS NULL`), `fila` (`pgboss.job` existe e responde) e `worker` (batimento de `service = 'worker'` com idade ≤ 180 s). Cada check com timeout de 2 s e `detail` curto e fixo (sem mensagem de erro interna, caminho nem segredo); `status = "ok"` só se todos `ok`.
- Rota `GET /api/health/ready` → `checkReadiness`; 200 se `ok`, 503 se `degraded`; `force-dynamic`; **sem autenticação** (é para healthcheck), por isso sem detalhes sensíveis.
- Worker: `recordHeartbeat("worker")` ao subir e `setInterval` a cada 60 s (parado no shutdown).

- [ ] **Step 1: Write the failing tests:** tudo saudável → `ok` com 5 checks verdes; sem batimento → `worker` vermelho e `degraded`; batimento de 200 s → vermelho, de 60 s → verde; migração falha pendente (linha com `finished_at NULL`) → `migracoes` vermelho; extensão `vector` ausente simulada (check com consulta injetável) → vermelho; banco que não responde (db com `$queryRaw` rejeitando) → `banco` vermelho e a resposta não contém a mensagem do erro; `fila` vermelha se `pgboss.job` não existe; a rota devolve 503 quando degradado e 200 quando ok; corpo sem `postgres://`, caminho de arquivo ou stack; `recordHeartbeat` atualiza `beatAt`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (e ligar o batimento no worker; atualizar o healthcheck do compose de desenvolvimento só se for trivial, senão deixe).
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(operacao): verificação de saúde completa e batimento do worker`.

---

### Task 6: Saúde do sistema na administração e logs com id de requisição

**Files:** Create `src/modules/system/{queues,backup,overview}.ts`, `src/lib/request-log.ts`, `src/app/(app)/admin/saude/page.tsx`; Modify `src/lib/http.ts`, `src/app/(app)/admin/layout.tsx`, `src/modules/system/index.ts`; Test `tests/unit/backup-state.test.ts`, `tests/integration/system-overview.test.ts`, `tests/unit/request-log.test.ts`, `tests/integration/request-id.test.ts`

**Interfaces:**
- Produces (`queues.ts`): `getQueueStats(db?): Promise<{ name: string; pending: number; active: number; failed: number; oldestPendingSeconds: number | null }[]>` (de `pgboss.job`: `created`/`retry` = pendentes, `active`, `failed`; `[]` se o schema não existe).
- Produces (`backup.ts`): `type BackupState = { lastBackupAt: string | null; lastBackupBytes: number | null; lastBackupOk: boolean; lastRestoreTestAt: string | null; lastRestoreTestOk: boolean | null; detail?: string }`; `parseBackupState(raw: unknown): BackupState | null` (validação Zod; campos desconhecidos ignorados; qualquer coisa inválida → `null`); `readBackupState(path = process.env.BACKUP_STATE_FILE): Promise<{ configured: boolean; state: BackupState | null; stale: boolean; ageHours: number | null }>` (arquivo ausente ou ilegível → `state: null`, nunca lança; `stale` se `lastBackupAt` > 26 h ou ausente com arquivo configurado).
- Produces (`overview.ts`): `getSystemOverview(actor): Promise<{ readiness; queues; webhooks: { delivered; pending; failed: number }; backup; database: { sizeBytes: number; tickets: number; articles: number; vectors: number } }>` (exige `admin:manage`, senão `ForbiddenError`; webhooks das últimas 24 h de `WebhookDelivery`).
- Produces (`request-log.ts`): `resolveRequestId(header: string | null): string` (aceita só `[A-Za-z0-9._-]{8,64}`, senão gera UUID); `logRequest(...)`. Em `http.ts`, `withAuth`, `withErrors` e `withApiKey` passam a: resolver o id, medir o tempo, devolver o cabeçalho `X-Request-Id` e logar `{ requestId, method, path, status, ms }` (info; erro 5xx com `level: error`); **nunca** logar corpo, cabeçalhos de autenticação nem query string.
- Página `/admin/saude` (`admin:manage`; item "Saúde" em `admin/layout.tsx`): checks com ícone e estado, filas, avisos ao n8n, backup (alerta amarelo se `stale`, "não configurado" se sem arquivo), banco.

- [ ] **Step 1: Write the failing tests:** `backup-state` (válido; campo faltando/tipo errado → `null`; arquivo ausente → `configured`/`state null` sem lançar; `stale` com 27 h e não com 25 h; JSON malformado); `system-overview` (admin vê tudo; líder/técnico `ForbiddenError`; contagens de filas com jobs criados à mão; webhooks das últimas 24 h e não as de 2 dias atrás; tamanho do banco > 0; sem schema do pg-boss → `queues []`); `request-log` (id válido é mantido, inválido/longo/com espaço é substituído; o log não contém corpo nem `Authorization`); `request-id` (rota com `withAuth` devolve `X-Request-Id`; respeita o enviado quando seguro; 5xx loga nível erro; resposta 401 também leva o id).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS (+ `tests/integration/tickets-api.test.ts`, `api-v1.test.ts`, `login.test.ts` para checar que os wrappers não quebraram); typecheck + eslint.
- [ ] **Step 5: Commit** `feat(operacao): página de saúde do sistema e id de requisição nos logs`.

---

### Task 7: Imagem enxuta e pacote de produção

**Files:** Create `docker-compose.prod.yml`, `config/caddy/Caddyfile`, `.env.prod.example`, `scripts/prod-init.sh`; Modify `Dockerfile`, `.gitignore`; Test `tests/unit/prod-config.test.ts`

**Interfaces:**
- `Dockerfile`: o alvo `web` não copia mais o `node_modules` completo do build; usa um estágio `migrate` com `npm ci --omit=dev --ignore-scripts` mais o CLI do Prisma (se o `prisma` estiver em `devDependencies`, instale só ele e as dependências do `prisma.config.ts` nesse estágio) e copia só isso para rodar `prisma migrate deploy`. O alvo `worker` continua com o código completo.
- `docker-compose.prod.yml`: serviços `caddy` (`caddy:2`, `Caddyfile` montado, volumes de dados do Caddy, portas `127.0.0.1:${HTTPS_PORT:-8443}:443` e `127.0.0.1:${HTTP_PORT:-8080}:80`), `web`, `worker`, `postgres` (`pgvector/pgvector:pg16`, volume nomeado, **sem** porta publicada), rede interna; `restart: unless-stopped`; healthchecks (`web` em `/api/health`, `postgres` com `pg_isready`); `mem_limit`; `logging` com rotação (`max-size: 10m`, `max-file: 3`); `web` monta `${BACKUP_DIR:-./backups}:/backups:ro` e recebe `BACKUP_STATE_FILE=/backups/estado-backup.json`; variáveis lidas de `.env.prod` (`env_file`) com `SESSION_SECRET`, `POSTGRES_PASSWORD` obrigatórios (`:?`); `APP_URL` padrão `https://localhost:${HTTPS_PORT:-8443}`; `AI_ENABLED` padrão `false`.
- `config/caddy/Caddyfile`: `{ local_certs }`; site `localhost:443` com `tls internal`, `encode zstd gzip`, cabeçalhos de segurança (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`), `reverse_proxy web:3000`; `X-Forwarded-For` tratado como o app espera (`TRUSTED_PROXY_HOPS=1`).
- `scripts/prod-init.sh` (bash, `set -euo pipefail`): se `.env.prod` não existe, cria a partir de `.env.prod.example` com `SESSION_SECRET` (`openssl rand -hex 32`), `POSTGRES_PASSWORD` (`openssl rand -hex 16`) e `N8N_WEBHOOK_SECRET` (`openssl rand -hex 32`), `chmod 600`; **nunca imprime os valores**; se já existe, não sobrescreve; imprime os próximos passos (`podman-compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`, criar admin com `scripts/…`/`admin:create`). `.gitignore` ignora `.env.prod` e `backups/`.

- [ ] **Step 1: Write the failing tests** (`prod-config.test.ts`, verificações de texto/estrutura como `deploy-config.test.ts`): o compose de produção não publica Postgres, `web` nem `worker`; só `127.0.0.1` nas portas do Caddy; sem senha fixa (`POSTGRES_PASSWORD` com `:?`); healthchecks, `restart`, `mem_limit` e rotação de logs presentes; `Caddyfile` tem `tls internal` e `reverse_proxy web:3000` e os cabeçalhos de segurança; `Dockerfile` do `web` não tem mais `COPY --from=build /app/node_modules`; `prod-init.sh` tem `set -euo pipefail`, `chmod 600`, não usa `echo` com as variáveis dos segredos e não sobrescreve `.env.prod` existente; **execução real** do `prod-init.sh` num diretório temporário: cria `.env.prod` com permissão `600`, valores com ≥ 32 caracteres hexadecimais, segunda execução não muda o arquivo, e a saída não contém nenhum dos valores gerados; `.gitignore` cobre `.env.prod` e `backups/`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx vitest run tests/unit/deploy-config.test.ts` (o compose de desenvolvimento não pode regredir).
- [ ] **Step 5: Commit** `feat(operacao): imagem enxuta e compose de produção local com Caddy`.

---

### Task 8: Backup, restauração e teste de restauração

**Files:** Create `scripts/{backup,restore,restore-test}.sh`, `deploy/systemd/{chamados-backup,chamados-restore-test}.{service,timer}`; Test `tests/integration/ops-backup.test.ts`, `tests/unit/ops-scripts.test.ts`

**Interfaces:** os três scripts são `bash` com `set -euo pipefail`, falham com mensagem clara e **não** usam `eval`. Variáveis (com padrões): `RUNTIME` (`podman`, ou `docker` se não houver podman), `PG_CONTAINER` (nome do contêiner do Postgres), `PG_USER`, `PG_DB`, `UPLOADS_DIR` (diretório de anexos no host, ou `UPLOADS_VOLUME` para volume nomeado), `BACKUP_DIR` (`$HOME/backups/chamados`), `PG_IMAGE` (`docker.io/pgvector/pgvector:pg16`). A senha vem do ambiente do contêiner (nunca na linha de comando).
- `backup.sh`: `pg_dump -Fc` dentro do contêiner → `BACKUP_DIR/chamados-AAAAMMDD-HHMMSS.dump`; `tar czf` dos anexos → `…-anexos.tar.gz` (vazio se não houver); verifica que o dump não está vazio (`pg_restore --list`); retenção: mantém os 14 mais recentes e, dos demais, um por semana até 8; grava `estado-backup.json` (`lastBackupAt` ISO, `lastBackupBytes`, `lastBackupOk: true`, preserva os campos de teste de restauração) **só depois** de sucesso; em falha grava `lastBackupOk: false` com `detail` curto e sai com código ≠ 0 **sem** apagar backups antigos; escrita do estado atômica (`mv` de arquivo temporário).
- `restore.sh <arquivo.dump> [anexos.tar.gz]`: exige `--yes` ou confirmação digitada (`restaurar`) antes de tocar no banco vivo; restaura com `pg_restore --clean --if-exists`; sem argumento, lista os backups disponíveis.
- `restore-test.sh`: sobe um Postgres descartável (`$RUNTIME run --rm` com `PG_IMAGE`, nome único, porta não publicada), restaura o dump mais recente, compara contagens de `User`, `Ticket`, `Comment`, `KbArticle` e vetores (`KbChunk`, `TicketEmbedding`) com as do banco vivo (tolerância: o vivo pode ter **mais** linhas desde o backup, nunca menos que o restaurado), confere o `COUNT` de arquivos do tar dos anexos, remove o contêiner descartável **sempre** (`trap`), e grava `lastRestoreTestAt`/`lastRestoreTestOk` no estado; falha de qualquer conferência → `lastRestoreTestOk: false`, `detail` e código ≠ 0.
- Systemd (usuário): `chamados-backup.service` (executa `backup.sh`) e `.timer` (`OnCalendar=*-*-* 02:00:00`, `Persistent=true`); `chamados-restore-test.service` e `.timer` (`OnCalendar=Sun *-*-* 03:30:00`, `Persistent=true`); instruções de instalação em `docs/operacao.md` (Task 9).

- [ ] **Step 1: Write the failing tests:** `ops-scripts.test.ts` (texto: `set -euo pipefail`, sem `eval`, `restore.sh` exige confirmação, `backup.sh` grava o estado só após sucesso e de forma atômica, `restore-test.sh` usa `trap` para remover o contêiner, nenhum script recebe senha por argumento; unidades systemd com `Persistent=true` e os horários combinados); `ops-backup.test.ts` (**ponta a ponta com Postgres real**, como `startTestDb`, e `RUNTIME` real do ambiente): popula usuários, chamados, um artigo e um vetor; `backup.sh` cria dump e tar não vazios e grava o estado `lastBackupOk: true` (parseável por `parseBackupState`); `restore-test.sh` passa e grava `lastRestoreTestOk: true`; corromper o dump (truncar o arquivo) faz `restore-test.sh` falhar com `lastRestoreTestOk: false` e código ≠ 0; `restore.sh` sem confirmação não altera o banco e com `--yes` restaura num banco de teste e as contagens batem; retenção com 20 dumps falsos deixa os 14 mais recentes mais os semanais, nunca apaga quando o backup novo falha; falha do `pg_dump` (contêiner inexistente) grava `lastBackupOk: false` e preserva os antigos.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx eslint scripts tests`.
- [ ] **Step 5: Commit** `feat(operacao): backup diário, restauração e teste de restauração`.

---

### Task 9: Documentação, E2E e verificação final

**Files:** Create `docs/operacao.md`, `tests/e2e/operacao.spec.ts`; Modify `README.md`, `docs/ia.md`, `docs/notes/2026-10-01-pendencias-fases-0-1.md`, `package.json` (scripts `prod:init`, `prod:up`, `backup`, `restore:test`), `tests/e2e/start.mts` (se precisar semear a demo)

**Interfaces:**
- `docs/operacao.md`: pré-requisitos, `npm run prod:init`, subir (`prod:up`), primeiro acesso (aceitar o certificado local do Caddy), criar o primeiro admin, ligar a chave do Gemini, parar, atualizar (pull, build, migrar, reiniciar), voltar versão, backup e timers do systemd, restauração, teste de restauração, solução de problemas (`/api/health/ready`, logs, fila parada, backup atrasado) e a recomendação de guardar cópia fora da máquina.
- `README.md`: seção "Painel de métricas" (com a observação de que os números de demonstração são fictícios e marcados), link para `docs/operacao.md` e diagrama de produção em texto.
- E2E `operacao.spec.ts`: o líder abre o Dashboard e vê "Satisfação" e "IA no atendimento" (com o aviso de demonstração) e **não** vê "Uso e custo de IA"; o admin vê as três seções, inclusive a tabela por tarefa; o admin abre `/admin/saude` e vê os checks (o worker do E2E bate o coração) e "backup não configurado"; o técnico e o solicitante recebem 404 em `/admin/saude`; `GET /api/health/ready` responde 200 com `status: "ok"`.

- [ ] **Step 1: Write the failing test:** `operacao.spec.ts` (o E2E precisa do seed com a demonstração: `tests/e2e/start.mts` já roda `prisma db seed`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** docs e scripts do `package.json`; ajustar o seed do E2E se necessário.
- [ ] **Step 4: Verificação final** (nesta ordem; E2E numa cópia do repositório se houver `next dev` na porta 3000: `git worktree add` + `cp -a --reflink=auto node_modules` + `npx prisma generate`, `timeout` de pelo menos 580 s e limpar processos na 3100 antes): `npx eslint .`; `npm run typecheck`; `npx vitest run`; `npm run test:integration` e de novo com `TZ=UTC`; `npx playwright test`; `npm run build`; `npm audit --omit=dev --audit-level=high`; **fumaça real do pacote de produção:** `scripts/prod-init.sh` num diretório temporário, `podman-compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`, esperar saudável, `curl -k https://localhost:8443/api/health/ready` → `ok`, criar admin, `scripts/backup.sh` e `scripts/restore-test.sh` contra os contêineres reais com estado `lastRestoreTestOk: true`, `down -v` e limpeza.
- [ ] **Step 5: Commit** `feat(operacao): documentação de operação, E2E e verificação do pacote de produção`.
