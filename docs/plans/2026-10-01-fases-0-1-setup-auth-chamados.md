# Fases 0–1: Setup, Auth e CRUD de Chamados — Plano de Implementação


**Goal:** Entregar a base do sistema (infra, CI, tema) e o núcleo funcional: login por convite com papéis e CRUD de chamados com comentários, anexos, busca e paginação.

**Architecture:** Monólito modular Next.js com worker pg-boss separado (mesmo código, outro entrypoint), PostgreSQL com pgvector e Prisma. Cada módulo em `src/modules/<nome>` expõe só um `index.ts` público. Toda autorização passa por `can()`.

**Tech Stack:** Next.js (App Router, Route Handlers), TypeScript, Prisma, PostgreSQL + pgvector + pg_trgm, pg-boss, Zod, argon2, Tailwind, shadcn/ui, React Bits (TS-TW), Vitest, Testcontainers, Playwright, pino, Docker Compose, GitHub Actions.

**Spec:** `docs/specs/2026-10-01-glpi-ia-design.md`

Fora deste plano (planos próprios depois): Fase 2 (SLA, equipes avançadas, e-mail, dashboard), Fases 3–5 (IA), Fase 6 (métricas e deploy), importador do GLPI.

## Global Constraints

- Login por e-mail e senha, **cadastro só por convite**; sem SSO.
- Hash **argon2id**; senha mínimo **12 caracteres**; bloqueio após **5 falhas** (`failedLogins`, `lockedUntil`).
- Sessão no banco; cookie `HttpOnly`, `Secure`, `SameSite=Lax`; rotação no login; revogação ao trocar a senha.
- Tokens de convite e reset guardados **só como hash**, uso único, com expiração.
- Papéis: `REQUESTER | AGENT | TEAM_LEAD | ADMIN`. Status: `NEW | OPEN | PENDING | RESOLVED | CLOSED`. Tipo: `INCIDENT | REQUEST`.
- Autorização exclusivamente via `can(user, action, resource)` em `modules/auth`.
- Entrada validada com Zod; Prisma parametrizado; `$queryRaw` só com parâmetros; texto sempre escapado.
- Anexos: limite de tamanho, tipos permitidos, nome gerado no servidor, fora do diretório público.
- Índices: `(status, teamId, assigneeId)`, `createdAt`, `pg_trgm` no título; paginação em toda listagem.
- Cada módulo expõe só `index.ts`; sem imports de arquivos internos de outro módulo.
- Embedding futuro `vector(768)`; extensões `vector` e `pg_trgm` habilitadas na migration inicial.
- Seed 100% fictício; nenhum dado ou nome real da empresa em nenhum commit; segredos só em variáveis de ambiente.
- Tema escuro por padrão; respeitar `prefers-reduced-motion`; React Bits só em telas leves (login, dashboard), nunca em lista/detalhe de chamado.
- Interface e mensagens em português do Brasil.

## Review Focus

- Login com e-mail em caixa diferente (`Ana@X.com` vs `ana@x.com`) deve achar a mesma conta (e-mail normalizado em minúsculas).
- Token de convite/reset reutilizado ou expirado deve falhar com a mesma mensagem genérica, sem revelar o motivo.
- Solicitante acessando por URL direta o chamado de outro usuário recebe 404, não 403 (não confirma existência).
- Título/descrição/comentário com HTML ou `<script>` deve aparecer como texto, nunca executar.
- Busca por texto com caracteres especiais (`%`, `_`, `'`) não quebra nem retorna tudo.
- Página de listagem fora do intervalo (`page=9999`, `pageSize=100000`) retorna vazio/limitado, não erro 500.
- Anexo com extensão permitida mas conteúdo/tipo divergente, ou nome com `../`, é rejeitado.
- Duas criações simultâneas de chamado não geram o mesmo número sequencial.

## Estrutura de arquivos

```
src/lib/config.ts            # env validado por Zod
src/lib/db.ts                # PrismaClient singleton
src/lib/logger.ts            # pino
src/lib/queue.ts             # pg-boss (start, enqueue)
src/worker/index.ts          # entrypoint do worker
src/app/api/health/route.ts
src/modules/auth/            # password, session, login, invite, reset, can
src/modules/users/ teams/ tickets/
src/app/(auth)/login ...     # telas
src/components/ui/           # shadcn
src/components/bits/         # React Bits (copiados)
prisma/schema.prisma, prisma/seed.ts
docker-compose.yml, Dockerfile
.github/workflows/ci.yml, .github/dependabot.yml
```

---

# FASE 0 — Setup

### Task 1: Scaffold do projeto e ferramentas de qualidade

**Files:**
- Create: projeto Next.js (App Router, TypeScript, Tailwind, ESLint, `src/`) em `/home/lucas/glpi_IA`, `vitest.config.ts`, `tests/smoke.test.ts`, `.gitignore`
- Modify: `package.json` (scripts `lint`, `typecheck`, `test`, `test:integration`)

**Interfaces:**
- Produces: scripts npm `lint`, `typecheck`, `test` (unitários, `tests/unit/**`), `test:integration` (`tests/integration/**`); alias `@/` → `src/`.

- [ ] **Step 1: Write the failing test** `tests/unit/smoke.test.ts`: `expect(1 + 1).toBe(2)` e importar `@/lib/config` ainda inexistente falha por resolução.
- [ ] **Step 2: Run** `npm test` → FAIL (script ou módulo ausente).
- [ ] **Step 3: Scaffold** com `create-next-app` na pasta atual preservando `docs/` e o git; instalar Vitest; configurar alias `@/` e os quatro scripts; `.gitignore` cobre `.env`, `node_modules`, `.next`, uploads.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test` → todos passam (o teste de smoke agora só afirma `1+1`).
- [ ] **Step 5: Commit** `chore: scaffold Next.js, Vitest e scripts de qualidade`.

### Task 2: Configuração de ambiente validada

**Files:**
- Create: `src/lib/config.ts`, `.env.example`, `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: Record<string, string | undefined>): Config` e `config: Config` (singleton lazy). Campos: `DATABASE_URL`, `SESSION_SECRET` (≥32 chars), `APP_URL`, `LLM_PROVIDER` (`gemini|anthropic`, default `gemini`), `EMBEDDING_PROVIDER` (default `gemini`), `AI_ENABLED` (bool, default `false`), `AI_DAILY_BUDGET` (number, default 5), `SMTP_*` opcionais, `UPLOAD_DIR`.

- [ ] **Step 1: Write failing tests:** `loadConfig({})` lança com a lista de variáveis faltantes; `SESSION_SECRET` de 10 chars lança; `AI_ENABLED="true"` vira `true`; valores default aplicados.
- [ ] **Step 2: Run** `npx vitest run tests/unit/config.test.ts` → FAIL.
- [ ] **Step 3: Implement** `loadConfig` com Zod (`z.coerce` onde couber); `.env.example` com todas as chaves e valores de exemplo **sem segredos reais**.
- [ ] **Step 4: Run** o mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat: configuração de ambiente validada com Zod`.

### Task 3: Docker Compose do Postgres, Prisma e extensões

**Files:**
- Create: `docker-compose.yml` (serviço `postgres` com imagem `pgvector/pgvector`), `prisma/schema.prisma` (modelos `Team`, `Category` mínimos), migration inicial com `CREATE EXTENSION vector, pg_trgm`, `src/lib/db.ts`, `tests/integration/helpers/db.ts`, `tests/integration/db.test.ts`

**Interfaces:**
- Produces: `db: PrismaClient`; helper de teste `startTestDb(): Promise<{ url: string; stop(): Promise<void> }>` que sobe um Postgres pgvector via Testcontainers e roda `prisma migrate deploy`.

- [ ] **Step 1: Write failing test** `db.test.ts`: após `startTestDb()`, `SELECT extname FROM pg_extension` contém `vector` e `pg_trgm`; criar `Team{name}` e ler de volta.
- [ ] **Step 2: Run** `npm run test:integration` → FAIL.
- [ ] **Step 3: Implement** compose, schema com `Team(id, name unique)` e `Category(id, name, parentId?, defaultTeamId?)`, migration com as extensões (SQL manual na migration), singleton `db`, helper de teste.
- [ ] **Step 4: Run** `npm run test:integration` → PASS (requer Docker local).
- [ ] **Step 5: Commit** `feat: Postgres com pgvector, Prisma e helper de testes`.

### Task 4: Logger e health check

**Files:**
- Create: `src/lib/logger.ts`, `src/app/api/health/route.ts`, `tests/integration/health.test.ts`

**Interfaces:**
- Produces: `logger` (pino, nível por env, campo `correlationId` aceito); `GET /api/health` → `200 {status:"ok", db:"up"}` ou `503 {status:"degraded", db:"down"}`.

- [ ] **Step 1: Write failing tests:** com o banco de teste, `GET()` do handler retorna 200 e `db:"up"`; com `DATABASE_URL` inválido retorna 503.
- [ ] **Step 2: Run** `npx vitest run tests/integration/health.test.ts` → FAIL.
- [ ] **Step 3: Implement** o handler com `SELECT 1` e timeout curto; logger pino.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: logger estruturado e /api/health`.

### Task 5: Worker com pg-boss

**Files:**
- Create: `src/lib/queue.ts`, `src/worker/index.ts`, `tests/integration/queue.test.ts`
- Modify: `package.json` (script `worker`)

**Interfaces:**
- Produces: `getQueue(): Promise<PgBoss>`; `enqueue<T>(name: string, data: T, opts?: { tx?: PrismaTransaction }): Promise<string | null>`; `registerHandler<T>(name: string, handler: (data: T) => Promise<void>)`; job de sistema `system.ping`.

- [ ] **Step 1: Write failing test:** enfileirar `system.ping` com um handler registrado; esperar até 5 s; o handler é chamado uma vez com o payload; um handler que lança é reprocessado (retry) uma vez.
- [ ] **Step 2: Run** `npx vitest run tests/integration/queue.test.ts` → FAIL.
- [ ] **Step 3: Implement** pg-boss usando o schema `pgboss` no mesmo `DATABASE_URL`; `worker/index.ts` inicia a fila, registra handlers e trata `SIGTERM` com parada limpa.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: worker com pg-boss e fila transacional`.

### Task 6: Tema, shadcn/ui e React Bits

**Files:**
- Create: `src/components/ui/*` (via shadcn: button, input, card, dialog, table, toast), `src/components/bits/Aurora.tsx` (React Bits, TS-TW), `src/components/LazyBackground.tsx`, `THIRD_PARTY.md`, `tests/unit/lazy-background.test.tsx`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: `<LazyBackground />`: carrega `Aurora` sob demanda e **não renderiza** quando `prefers-reduced-motion: reduce`; tokens de tema escuro por padrão com classe `light` opcional.

- [ ] **Step 1: Write failing test:** com `matchMedia('(prefers-reduced-motion: reduce)')` verdadeiro, `LazyBackground` não renderiza canvas; com falso, renderiza o placeholder e depois o componente.
- [ ] **Step 2: Run** `npx vitest run tests/unit/lazy-background.test.tsx` → FAIL.
- [ ] **Step 3: Implement:** instalar shadcn e o componente com `npx shadcn@latest add @react-bits/Aurora-TS-TW`; confirmar a licença no site `reactbits.dev` (link `License`) e registrar em `THIRD_PARTY.md` (nome, autor, licença, URL); tema escuro por padrão em `layout.tsx`.
- [ ] **Step 4: Run** o teste → PASS; abrir `npm run dev` e verificar visualmente o fundo na página inicial.
- [ ] **Step 5: Commit** `feat: tema escuro, shadcn/ui e fundo React Bits sob demanda`.

### Task 7: Seed fictício base

**Files:**
- Create: `prisma/seed.ts`, `tests/integration/seed.test.ts`
- Modify: `package.json` (`prisma.seed`)

**Interfaces:**
- Produces: `seed(db: PrismaClient): Promise<void>`, idempotente: cria equipes fictícias (`Infraestrutura`, `Suporte N1`, `Sistemas`) e árvore de categorias (`Hardware`, `Software`, `Rede`, `Acessos`). Usuários e chamados fictícios entram na Task 17.

- [ ] **Step 1: Write failing test:** rodar `seed` duas vezes resulta em exatamente 3 equipes e as categorias esperadas (sem duplicar).
- [ ] **Step 2: Run** `npx vitest run tests/integration/seed.test.ts` → FAIL.
- [ ] **Step 3: Implement** com `upsert` por nome.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: seed fictício idempotente`.

### Task 8: Dockerfile e Compose completo

**Files:**
- Create: `Dockerfile` (multi-stage; alvo `web` e alvo `worker`), `.dockerignore`
- Modify: `docker-compose.yml` (serviços `web`, `worker`, `postgres`, healthchecks)

**Interfaces:**
- Produces: `docker compose up` sobe os três serviços; `web` roda `prisma migrate deploy` antes de iniciar.

- [ ] **Step 1: Write failing check:** `docker compose up -d --build && curl -sf http://localhost:3000/api/health` — antes de existir, falha.
- [ ] **Step 2: Run** o comando → FAIL.
- [ ] **Step 3: Implement** Dockerfile e Compose com `depends_on` condicionado a `service_healthy`.
- [ ] **Step 4: Run** o comando → resposta `{"status":"ok","db":"up"}`; `docker compose logs worker` mostra o worker iniciado; `docker compose down`.
- [ ] **Step 5: Commit** `feat: Dockerfile e Compose com web, worker e postgres`.

### Task 9: CI e higiene do repositório público

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `LICENSE` (MIT), `SECURITY.md`, `README.md` (esqueleto com seções Visão geral, Arquitetura, Rodando localmente, Fases), `.gitleaks.toml` se necessário

**Interfaces:**
- Produces: workflow que roda `lint`, `typecheck`, `test`, `test:integration`, `build`, `gitleaks` e `npm audit --audit-level=high` em push e PR.

- [ ] **Step 1: Write failing check:** `npx --yes yaml-lint .github/workflows/ci.yml` (ou `actionlint`) falha por arquivo ausente.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** os arquivos; README descreve o objetivo e como subir o ambiente (`cp .env.example .env`, `docker compose up`).
- [ ] **Step 4: Run** o lint do workflow → PASS; rodar `gitleaks detect` localmente e confirmar zero achados.
- [ ] **Step 5: Commit** `chore: CI, Dependabot, licença MIT, SECURITY e README base`.

---

# FASE 1 — Auth e CRUD de chamados

### Task 10: Schema de identidade e chamados

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration, `tests/integration/schema.test.ts`

**Interfaces:**
- Produces (modelos Prisma): `User{id,name,email@unique,passwordHash?,role,active,failedLogins,lockedUntil?}`, `Session{id,userId,expiresAt,createdAt}`, `Invite{id,email,role,tokenHash,expiresAt,usedAt?,createdById}`, `PasswordReset{id,userId,tokenHash,expiresAt,usedAt?}`, `TeamMember{userId,teamId,@@id}`, `Ticket{id,number Int @unique (sequência),title,description,status,priority(LOW|MEDIUM|HIGH|CRITICAL),type,requesterId,assigneeId?,teamId?,categoryId?,createdAt,updatedAt,resolvedAt?,closedAt?}`, `Comment{id,ticketId,authorId,body,internal,source(WEB|EMAIL|AI_DRAFT),createdAt}`, `Attachment{id,ticketId,uploaderId,filename,storedName,mimeType,size,createdAt}`, `TicketEvent{id,ticketId,actorId,type,data Json,createdAt}`. Índices `(status,teamId,assigneeId)`, `createdAt`, e `CREATE INDEX ... USING gin (title gin_trgm_ops)` via SQL na migration.

- [ ] **Step 1: Write failing test:** com o banco de teste, `\d "Ticket"` mostra os índices esperados (consultar `pg_indexes`); inserir dois usuários com o mesmo e-mail viola a unicidade; a sequência de `number` incrementa.
- [ ] **Step 2: Run** `npx vitest run tests/integration/schema.test.ts` → FAIL.
- [ ] **Step 3: Implement** o schema e a migration (sequência do número e o índice trigram em SQL manual).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: schema de identidade e chamados com índices`.

### Task 11: Senhas (hash e política)

**Files:**
- Create: `src/modules/auth/password.ts`, `tests/unit/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>` (argon2id), `verifyPassword(hash: string, plain: string): Promise<boolean>`, `validatePasswordPolicy(plain: string): { ok: true } | { ok: false; reason: string }` (mínimo 12 caracteres; rejeita lista curta de senhas comuns embutida).

- [ ] **Step 1: Write failing tests:** hash começa com `$argon2id$`; verifica correto/incorreto; `validatePasswordPolicy("curta")` falha; `"senha1234567"` e `"password1234"` (comuns) falham; `"Tr0ca-Isto-Aqui!"` passa.
- [ ] **Step 2: Run** `npx vitest run tests/unit/password.test.ts` → FAIL.
- [ ] **Step 3: Implement** com a biblioteca `argon2`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(auth): hash argon2id e política de senha`.

### Task 12: Sessões e login com bloqueio

**Files:**
- Create: `src/modules/auth/session.ts`, `src/modules/auth/login.ts`, `src/modules/auth/rate-limit.ts`, `src/modules/auth/index.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `tests/integration/login.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `db`.
- Produces: `login(input: { email: string; password: string; ip: string }): Promise<{ ok: true; sessionToken: string; user: SessionUser } | { ok: false }>` (e-mail normalizado em minúsculas; resposta de falha sempre igual); `getSessionUser(token: string): Promise<SessionUser | null>`; `revokeSessions(userId: string): Promise<void>`; `SessionUser = { id; name; email; role; teamIds: string[] }`; `checkRateLimit(key: string, limit: number, windowSec: number): boolean` (em memória por processo; documentado como limitação).

- [ ] **Step 1: Write failing tests:** login correto cria sessão e zera `failedLogins`; 5 falhas seguidas definem `lockedUntil` e a 6ª tentativa com a senha **correta** também falha; `Ana@X.com` encontra `ana@x.com`; usuário inexistente e senha errada retornam o mesmo resultado; `active=false` não loga; segundo login rotaciona (token diferente); `revokeSessions` invalida o token; o cookie definido no handler tem `HttpOnly`, `Secure` e `SameSite=Lax`.
- [ ] **Step 2: Run** `npx vitest run tests/integration/login.test.ts` → FAIL.
- [ ] **Step 3: Implement** token de sessão aleatório de 32 bytes, guardado no banco **como hash SHA-256**; expiração configurável (padrão 8 h); rate limit por IP e por e-mail no handler.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(auth): sessões, login com bloqueio e rate limit`.

### Task 13: Convites e reset de senha

**Files:**
- Create: `src/modules/auth/invite.ts`, `src/modules/auth/reset.ts`, rotas `src/app/api/auth/invite/route.ts`, `src/app/api/auth/accept-invite/route.ts`, `src/app/api/auth/forgot/route.ts`, `src/app/api/auth/reset/route.ts`, `tests/integration/invite-reset.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `validatePasswordPolicy`, `revokeSessions`, `enqueue` (apenas registra o e-mail em log até a Fase 2).
- Produces: `createInvite(input: { email: string; role: Role; createdById: string }): Promise<{ token: string }>`; `acceptInvite(input: { token: string; name: string; password: string }): Promise<{ ok: boolean }>`; `requestReset(email: string): Promise<void>` (sempre sucesso, mesma resposta); `resetPassword(input: { token: string; password: string }): Promise<{ ok: boolean }>` (revoga sessões do usuário).

- [ ] **Step 1: Write failing tests:** token só existe em claro no retorno e é salvo como hash; convite usado duas vezes falha; convite expirado falha; mesma resposta para e-mail existente e inexistente em `requestReset`; reset com senha fraca falha; reset válido troca a senha, marca `usedAt` e revoga sessões; só `ADMIN` cria convite.
- [ ] **Step 2: Run** `npx vitest run tests/integration/invite-reset.test.ts` → FAIL.
- [ ] **Step 3: Implement** tokens de 32 bytes com hash SHA-256; convite válido por 72 h, reset por 1 h.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(auth): convites e reset de senha`.

### Task 14: Autorização central `can()`

**Files:**
- Create: `src/modules/auth/can.ts`, `tests/unit/can.test.ts`
- Modify: `src/modules/auth/index.ts`

**Interfaces:**
- Produces: `type Action = "ticket:create" | "ticket:read" | "ticket:update" | "ticket:assign" | "ticket:close" | "comment:create" | "comment:read_internal" | "attachment:add" | "user:invite" | "user:manage"`; `can(user: SessionUser, action: Action, resource?: { requesterId?: string; teamId?: string | null; assigneeId?: string | null }): boolean`.

- [ ] **Step 1: Write failing tests (tabela papel × ação):** `REQUESTER` lê só quando `requesterId === user.id` e nunca `comment:read_internal`; `AGENT` lê/atualiza chamados cujo `teamId` esteja em `user.teamIds` ou que sejam dele; `TEAM_LEAD` também atribui dentro da equipe; só `ADMIN` tem `user:invite` e `user:manage`; fechar (`ticket:close`) exige `AGENT`+; recurso de outra equipe nega para `AGENT`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/can.test.ts` → FAIL.
- [ ] **Step 3: Implement** a função pura, sem acesso a banco.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(auth): autorização central can()`.

### Task 15: Serviço de chamados

**Files:**
- Create: `src/modules/tickets/service.ts`, `src/modules/tickets/schemas.ts`, `src/modules/tickets/index.ts`, `tests/integration/tickets-service.test.ts`

**Interfaces:**
- Consumes: `db`, `can`, `SessionUser`.
- Produces: `createTicket(actor: SessionUser, input: CreateTicketInput): Promise<Ticket>` (grava `TicketEvent` `CREATED`; ponto de extensão `onTicketCreated` vazio, usado na Fase 3 para enfileirar a triagem na mesma transação); `updateTicket(actor, id, patch): Promise<Ticket>` (registra `TicketEvent` com antes/depois); `changeStatus(actor, id, to: TicketStatus): Promise<Ticket>` (transições válidas: `NEW→OPEN→PENDING↔OPEN→RESOLVED→CLOSED`, reabrir `RESOLVED→OPEN`; define `resolvedAt`/`closedAt`); `listTickets(actor, query: { page: number; pageSize: number; status?; teamId?; assigneeId?; q?: string }): Promise<{ items: Ticket[]; total: number }>` (`pageSize` máx. 100; filtra por visibilidade do ator; `q` usa `pg_trgm` com parâmetros); `getTicket(actor, id): Promise<Ticket | null>` (retorna `null` quando o ator não pode ver, o handler traduz em 404).

- [ ] **Step 1: Write failing tests:** criar duas vezes seguidas dá números consecutivos; 20 criações concorrentes (`Promise.all`) geram 20 números distintos; transição inválida (`NEW→CLOSED`) lança; `REQUESTER` não vê chamado alheio em `listTickets` nem em `getTicket` (`null`); `page=9999` retorna `items=[]` e `total` correto; `pageSize=100000` é limitado a 100; `q` com `%`, `_` e `'` não quebra e não retorna tudo; evento é gravado a cada mudança.
- [ ] **Step 2: Run** `npx vitest run tests/integration/tickets-service.test.ts` → FAIL.
- [ ] **Step 3: Implement** o serviço com transações Prisma; busca com `$queryRaw` parametrizado combinando `similarity()`/`ILIKE` com escape dos curingas.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(tickets): serviço de chamados com eventos, filtros e busca`.

### Task 16: Route Handlers de chamados, comentários e anexos

**Files:**
- Create: `src/app/api/tickets/route.ts`, `src/app/api/tickets/[id]/route.ts`, `src/app/api/tickets/[id]/comments/route.ts`, `src/app/api/tickets/[id]/attachments/route.ts`, `src/modules/tickets/comments.ts`, `src/modules/tickets/attachments.ts`, `src/lib/http.ts`, `tests/integration/tickets-api.test.ts`

**Interfaces:**
- Consumes: serviço da Task 15, `getSessionUser`, `can`.
- Produces: `withAuth(handler)` em `src/lib/http.ts` (resolve a sessão do cookie; 401 sem sessão; erros Zod → 400 com mensagens em pt-BR; valida `Origin` em métodos que mudam estado); `addComment(actor, ticketId, input: { body: string; internal: boolean }): Promise<Comment>` (`internal` exige `can(..."comment:read_internal")`; `getComments` filtra internos para solicitantes); `saveAttachment(actor, ticketId, file: { name: string; type: string; size: number; stream: ReadableStream }): Promise<Attachment>` (limite padrão 10 MB; tipos permitidos: png, jpg, pdf, txt, log, docx, xlsx; confere o tipo real pelos primeiros bytes; nome salvo gerado por `crypto.randomUUID()` em `UPLOAD_DIR`; ignora o nome original no caminho).

- [ ] **Step 1: Write failing tests (HTTP):** sem cookie → 401; solicitante lendo `GET /api/tickets/{id}` de outro → 404; corpo inválido → 400; `Origin` de outro domínio em `POST` → 403; comentário com `<script>alert(1)</script>` é gravado como texto e retornado igual (o escape acontece na renderização); comentário interno não aparece para o solicitante; upload de `evil.pdf` com conteúdo executável → 400; nome `../../x.png` grava dentro de `UPLOAD_DIR` com nome gerado; arquivo de 11 MB → 413.
- [ ] **Step 2: Run** `npx vitest run tests/integration/tickets-api.test.ts` → FAIL.
- [ ] **Step 3: Implement** handlers finos que só validam, autorizam e delegam ao módulo.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(tickets): API de chamados, comentários e anexos`.

### Task 17: Telas e seed completo

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/accept-invite/page.tsx`, `src/app/(auth)/reset/page.tsx`, `src/app/(app)/layout.tsx` (guarda de sessão + navegação), `src/app/(app)/tickets/page.tsx` (lista com filtros, busca e paginação), `src/app/(app)/tickets/new/page.tsx`, `src/app/(app)/tickets/[id]/page.tsx` (detalhe, comentários, anexos, mudança de status), `src/components/SafeText.tsx` (renderiza texto escapado com Markdown restrito)
- Modify: `prisma/seed.ts` (usuários demo `admin`, `agent`, `requester` fictícios com senha de demonstração lida de `SEED_DEMO_PASSWORD`, e ~30 chamados fictícios variados)

**Interfaces:**
- Consumes: API das Tasks 12–16, `LazyBackground` (apenas em `(auth)`).
- Produces: `SafeText({ value: string })`: renderiza como texto, permite apenas negrito, itálico, listas e código inline; qualquer HTML é exibido literalmente.

- [ ] **Step 1: Write failing test** `tests/unit/safe-text.test.tsx`: `<SafeText value="<script>alert(1)</script>">` renderiza o texto literal e nenhum elemento `script`; `**negrito**` vira `<strong>`; `<img src=x onerror=...>` aparece como texto.
- [ ] **Step 2: Run** `npx vitest run tests/unit/safe-text.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `SafeText`, as páginas e o seed ampliado (a senha de demonstração vem de `SEED_DEMO_PASSWORD` no `.env.example`, sem valor real).
- [ ] **Step 4: Run** o teste → PASS; `npm run dev`, abrir cada tela e conferir login com fundo animado, lista sem animações pesadas e criação de chamado.
- [ ] **Step 5: Commit** `feat(ui): telas de login, lista, criação e detalhe de chamados`.

### Task 18: E2E do fluxo principal

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/ticket-flow.spec.ts`
- Modify: `package.json` (`test:e2e`), `.github/workflows/ci.yml` (job e2e)

**Interfaces:**
- Consumes: seed da Task 17.

- [ ] **Step 1: Write failing test:** o solicitante demo faz login, cria um chamado, vê na lista e comenta; o agente demo vê o chamado, adiciona nota interna, muda para `OPEN` e `RESOLVED`; o solicitante **não** vê a nota interna; tentativa de abrir por URL o chamado de outro solicitante mostra 404.
- [ ] **Step 2: Run** `npm run test:e2e` → FAIL.
- [ ] **Step 3: Implement** a configuração do Playwright (sobe o app e o banco de teste com seed) e ajustar o que o teste revelar.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS; gravar o fluxo em GIF para o README (anotar em `docs/` o comando usado).
- [ ] **Step 5: Commit** `test: E2E do fluxo de chamados e GIF para o README`.

---

## Auto-revisão

- **Cobertura do spec (Fases 0–1):** compose/Prisma/CI/tema/seed/licença (Tasks 1–9); auth por convite, reset, bloqueio, sessão, `can()` (11–14); chamados, comentários, anexos, índices, paginação, busca (10, 15–16); UI e React Bits só em telas leves (6, 17); E2E e GIF (18). Fases 2–6 e importador do GLPI: ficam para os próximos planos, por decisão de escopo explícita no topo.
- **Consistência de tipos:** `SessionUser`, `Action`, `can`, `enqueue`, `getQueue` definidos nas Tasks 5, 12 e 14 e usados com os mesmos nomes depois.
- **Review Focus:** cada item tem teste na task dona (e-mail em caixa diferente → 12; token reutilizado/expirado → 13; 404 em vez de 403 → 15/16; HTML escapado → 16/17; busca com caracteres especiais → 15; paginação fora do intervalo → 15; anexo adulterado/`../` → 16; números concorrentes → 15).
