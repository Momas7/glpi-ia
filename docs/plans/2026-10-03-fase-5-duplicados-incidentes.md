# Fase 5: duplicados, incidentes em massa e resumo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chamado novo ganha aviso de possíveis duplicados; muitos chamados parecidos viram um incidente (faixa na tela, página de gestão e evento ao n8n); o técnico resume conversas longas com um clique.

**Architecture:** Um vetor por chamado aberto (`OpenTicketVector`, gerado pelo job `ai.detect` e removido ao resolver) alimenta duas consultas de similaridade por cosseno no pgvector: duplicados (mesma equipe, 72 h) e incidente (qualquer equipe, 30 min). O resumo usa o wrapper de IA da Fase 3 e é salvo como `AiSuggestion` `SUMMARY`.

**Tech Stack:** Next.js 16 Route Handlers, Prisma 7 + Postgres/pgvector, pg-boss 12, Zod 4, Vitest/Testcontainers/Playwright; reutiliza `runEmbed`, `runAi`, `mask` das Fases 3 e 4.

**Spec:** `docs/specs/2026-10-03-fase-5-duplicados-incidentes-design.md` (fases anteriores: `…fase-3-triagem-ia-design.md`, `…fase-4-rag-design.md`; código em `src/modules/ai/`). Antes de escrever código de Next, leia o guia relevante em `node_modules/next/dist/docs/` (regra do `AGENTS.md`).

## Global Constraints

- Shell: `source ~/.nvm/nvm.sh && nvm use 24 >/dev/null` em **todo** comando, inclusive os de segundo plano. Antes de cada commit rode `npm run typecheck` e `npx eslint src tests scripts`. Integração (~10 min a suíte): rode só os arquivos da tarefa; a suíte toda e o E2E só na Task 10.
- Português do Brasil em telas, erros, commits e docs. Commits **sem** coautoria nem menção a IA como autora (regra do usuário).
- Padrões do repo: módulo com `index.ts` público; autorização só por `can()`; rotas com `withAuth`/`withAdmin`; erros por `AppError`; auditoria por `recordAudit`; TDD de verdade (teste visto falhar antes do código); texto de usuário sempre escapado; SQL cru só parametrizado.
- A IA só escreve em suas tabelas; nunca mescla, vincula, fecha chamado nem envia nada; saída do LLM é não confiável (Zod); conteúdo de chamados é dado, não instrução. Nenhum texto sai para LLM/embedding sem `mask()`. Embedding sempre 768 dimensões.
- Equipe com `Team.aiEnabled = false`: nada dela é embedado, sugerido ou resumido, e ela não entra em comparações.
- Valores: `AI_DUPLICATE_MIN_SIMILARITY` 0.85, `AI_DUPLICATE_WINDOW_HOURS` 72, `AI_INCIDENT_MIN_SIMILARITY` 0.75, `AI_INCIDENT_WINDOW_MINUTES` 30, `AI_INCIDENT_MIN_TICKETS` 5, `AI_MODEL_SUMMARY` opcional (padrão = modelo do rascunho); até 3 candidatos de duplicado; resumo exige ≥ 3 comentários (sem contar `AI_DRAFT`), texto até 2000 caracteres; permissões novas `incident:view` e `incident:close` (TEAM_LEAD e ADMIN).
- Estados abertos = `NEW`, `OPEN`, `PENDING`. Resolvido/fechado sai do índice de abertos.

## Review Focus

- Duplicado ou incidente que vaza: candidato de outra equipe, chamado resolvido/fechado, o próprio chamado ou equipe com IA desligada entrando na sugestão; técnico vendo link de chamado que não pode abrir (Tasks 3, 6).
- Incidente falso ou duplicado: 4 chamados não criam grupo, 5 criam **um** grupo e **um** evento, o 6º entra no mesmo grupo, chamados de outro assunto não entram; evento repetido ao reprocessar o job (Task 4).
- Vetor de chamado encerrado ou reaberto: resolver tira o chamado da comparação na hora (filtro na consulta), reabrir recoloca; grupo fecha sozinho só quando todos terminaram (Tasks 3, 4).
- Resumo: solicitante nunca vê nem gera; notas internas vão ao modelo mascaradas e o resumo fica só para a equipe; resumo de chamado com poucos comentários recusado sem chamar o modelo (Task 5).
- Falha de cota, teto estourado ou IA desligada nunca impedem criar/atualizar o chamado nem deixam estado pela metade (Tasks 3, 4, 5).

---

## File Structure

Criar:
- `prisma/migrations/20261006000000_deteccao/migration.sql`
- `src/modules/ai/{detect,incidents,summary}.ts`
- `src/app/api/tickets/[id]/ai/duplicates/route.ts`, `src/app/api/tickets/[id]/ai/summary/route.ts`, `src/app/api/incidents/[id]/close/route.ts`
- `src/app/(app)/incidentes/page.tsx`
- `src/components/{AiDuplicatesCard,AiSummaryCard,IncidentBanner,IncidentNotice}.tsx`, `src/components/forms/CloseIncidentButton.tsx`
- `scripts/ai-eval-dup.mts`, `tests/ai-eval/dup-pairs.json`
- Testes: indicados em cada tarefa.

Modificar: `prisma/schema.prisma`, `src/lib/config.ts`, `.env.example`, `docker-compose.yml`, `src/modules/auth/can.ts`, `src/modules/audit/index.ts`, `src/modules/ai/{index,enqueue,jobs,indexing,overview}.ts`, `src/modules/integrations/events.ts`, `src/modules/tickets/service.ts`, `src/modules/tickets/resolution.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/tickets/[id]/page.tsx`, `src/app/(app)/tickets/page.tsx`, `src/app/(app)/admin/ia/page.tsx`, `src/lib/nav.ts`, `docs/integracao-n8n.md`, `docs/ia.md`, `README.md`, `package.json`, `tests/e2e/start.mts`, `docs/notes/2026-10-01-pendencias-fases-0-1.md`.

---

### Task 1: Configuração

**Files:** Modify `src/lib/config.ts`, `.env.example`, `docker-compose.yml`; Test `tests/unit/config.test.ts`, `tests/unit/deploy-config.test.ts`

**Interfaces:** Produces em `Config`: `AI_DUPLICATE_MIN_SIMILARITY: number` (0..1, 0.85), `AI_DUPLICATE_WINDOW_HOURS: number` (inteiro ≥1, 72), `AI_INCIDENT_MIN_SIMILARITY: number` (0..1, 0.75), `AI_INCIDENT_WINDOW_MINUTES: number` (inteiro ≥1, 30), `AI_INCIDENT_MIN_TICKETS: number` (inteiro ≥2, 5), `AI_MODEL_SUMMARY?: string` (vazio vira `undefined`).

- [ ] **Step 1: Write the failing tests:** em `config.test.ts` os padrões acima; "0.9" aceito e "1.5" rejeitado para as duas similaridades; `AI_INCIDENT_MIN_TICKETS` "1" rejeitado e "8" aceito; `AI_DUPLICATE_WINDOW_HOURS` "0" rejeitado; `AI_MODEL_SUMMARY: ""` → `undefined`. Em `deploy-config.test.ts`: o compose repassa as seis variáveis (bloco comum `&app-env`) e o `.env.example` traz `AI_INCIDENT_MIN_TICKETS=5` e `AI_DUPLICATE_MIN_SIMILARITY=0.85`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/config.test.ts tests/unit/deploy-config.test.ts` → FAIL.
- [ ] **Step 3: Implement** (reaproveitar `optionalString`; no compose `${VAR:-valor}` com os padrões; comentários em português no `.env.example`).
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): configuração de duplicados, incidentes e resumo`.

---

### Task 2: Modelo de dados

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20261006000000_deteccao/migration.sql`; Test `tests/integration/schema-deteccao.test.ts`

**Interfaces:** Produces (Prisma): `AiSuggestionKind` ganha `DUPLICATE` e `SUMMARY`; enum `IncidentStatus { OPEN CLOSED }`; `IncidentGroup { id, title, status @default(OPEN), detectedAt @default(now()), closedAt?, closedById? (User), tickets Ticket[] }` com `@@index([status])`; `Ticket.incidentGroupId String?` (FK `onDelete: SetNull`, `@@index`); `OpenTicketVector { ticketId @id (cascade), contentHash, embedding Unsupported("vector(768)"), createdAt @default(now()) }` + `Ticket.openVector OpenTicketVector?`. SQL manual: `CREATE INDEX … USING hnsw ("embedding" vector_cosine_ops)` em `OpenTicketVector`.

- [ ] **Step 1: Write the failing test** (padrão de `schema-rag.test.ts`): `AiSuggestion` aceita `DUPLICATE` e `SUMMARY` e continua único por `(ticketId, kind)`; `IncidentGroup` nasce `OPEN`; ligar chamado ao grupo e apagar o grupo zera `incidentGroupId`; vetor de 768 entra em `OpenTicketVector` por SQL cru, vetor de 3 dimensões é recusado, consulta por cosseno devolve o mais próximo, apagar o chamado apaga o vetor, segunda linha do mesmo chamado viola a chave.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/schema-deteccao.test.ts` → FAIL.
- [ ] **Step 3: Implement** os modelos; gerar a migração com `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` contra o Postgres local migrado, **removendo do SQL** qualquer `DROP INDEX`/`ALTER` de objetos que o Prisma não conhece (`Ticket_slaSortDue_idx`, `Ticket_title_trgm_idx`, `slaSortDue`, índices HNSW existentes, CHECKs), acrescentar o índice HNSW; `ALTER TYPE … ADD VALUE` fica fora de transação — se o Prisma gerar o `ALTER TYPE` junto de uso do valor novo na mesma migração, mantenha só a adição. Aplicar no banco local com `npm run db:migrate` (se ficar `failed`, `prisma migrate resolve --rolled-back` depois de limpar o que sobrou).
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(deteccao): tabelas de vetores de abertos e grupos de incidente`.

---

### Task 3: Vetor do chamado aberto e duplicados

**Files:** Create `src/modules/ai/detect.ts`; Modify `src/modules/ai/{enqueue,jobs,indexing,index}.ts`, `src/modules/tickets/{service,resolution}.ts`; Test `tests/integration/ai-detect-duplicates.test.ts`

**Interfaces:**
- Consumes: `runEmbed`, `toVectorLiteral`, `contentHash`; de `indexing.ts` passa a exportar `embedSignature(deps)` e `signed(deps, text)` (já existem privados).
- Produces (`enqueue.ts`, folha): `AI_DETECT_QUEUE = "ai.detect"`, `enqueueDetect(tx: PrismaTransaction, ticketId: string): Promise<void>` (no-op se `process.env.AI_ENABLED !== "true"`).
- Produces (`detect.ts`): `type DetectDeps = Partial<EmbedDeps> & { config?: DetectConfig }` com `DetectConfig = { duplicateMinSimilarity; duplicateWindowHours; incidentMinSimilarity; incidentWindowMinutes; incidentMinTickets }` (padrão vem de `getConfig()`); `detectForTicket(ticketId: string, deps?: DetectDeps): Promise<"detected" | "removed" | "skipped">`; `findDuplicates(ticketId: string, deps?): Promise<{ ticketId: string; number: number; title: string; similarity: number }[]>`.
  - `detectForTicket`: chamado inexistente → `"skipped"`; status fora de `NEW/OPEN/PENDING` → apaga `OpenTicketVector` (e, Task 4, fecha grupo se for o caso) → `"removed"`; equipe com `aiEnabled=false` → apaga vetor → `"removed"`. Senão: texto `título\n\ndescrição` (descrição cortada em 4000), hash `signed`; vetor existente com mesmo hash reaproveita sem chamar o provider; senão `runEmbed({ jobType: "detect", ticketId, kind: "document" })` (`DISABLED`/`BUDGET` → `"skipped"`; erro propaga) e upsert por SQL cru. Em seguida `findDuplicates`; com candidatos e sem `AiSuggestion` `DUPLICATE` do chamado, cria uma `PENDING` com `payload = { candidates }` e `confidence` = maior similaridade. Depois chama o gancho de incidente da Task 4 (`detectIncident`, por ora ausente — a Task 4 o liga).
  - `findDuplicates`: consulta SQL parametrizada sobre `OpenTicketVector` ⋈ `Ticket`: status aberto, mesma `teamId` do chamado, `createdAt ≥ agora − janela`, `id ≠ self`, equipe com `aiEnabled`, similaridade `1 − (embedding <=> vetor do self) ≥ limiar`, até 3 por similaridade.
- Wiring: `createTicket` chama `enqueueDetect(tx, ticket.id)` depois de `enqueueTriage`; `applyStatus` chama `enqueueDetect` em **toda** mudança de status (resolver remove o vetor, reabrir/voltar a aberto o recoloca); `reopenTicket` também. `registerAiJobs` registra `ai.detect` (`detectForTicket(ticketId)`).

- [ ] **Step 1: Write the failing tests** (`ai-detect-duplicates.test.ts`, Postgres real, `FakeEmbeddingProvider`, dependências injetadas): chamado novo vê o vetor gravado (768 dimensões); dois chamados da mesma equipe com texto quase igual → sugestão `DUPLICATE` `PENDING` no mais novo com o número e o título do outro e similaridade; **não** sugere para chamado de outra equipe, para chamado criado há 73 h, para chamado `RESOLVED`/`CLOSED`, nem para o próprio; máximo 3 candidatos, ordenados; texto diferente (similaridade baixa) não gera sugestão; reprocessar o job não duplica a sugestão nem chama o provider de novo (hash igual); trocar o modelo reembeda; equipe com `aiEnabled=false` → `"removed"`, sem vetor e sem chamada ao provider; chamado resolvido → `"removed"` e vetor apagado; reaberto volta a ter vetor; `DISABLED`/`BUDGET` → `"skipped"` sem sugestão; erro do provider propaga e não grava nada; texto com CPF vai mascarado ao provider; `createTicket` enfileira `ai.detect` (com `AI_ENABLED=true`) e a mudança de status também; sem IA nada é enfileirado.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (nomes e SQL conforme os Interfaces).
- [ ] **Step 4: Run** o arquivo + `tests/integration/{tickets-service,tickets-resolution,ai-triage}.test.ts` → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): vetor do chamado aberto e sugestão de duplicados`.

---

### Task 4: Incidentes em massa

**Files:** Create `src/modules/ai/incidents.ts`, `src/app/api/incidents/[id]/close/route.ts`; Modify `src/modules/ai/{detect,index}.ts`, `src/modules/auth/can.ts`, `src/modules/audit/index.ts`, `src/modules/integrations/events.ts`, `docs/integracao-n8n.md`; Test `tests/unit/can.test.ts`, `tests/integration/ai-incidents.test.ts`, `tests/unit/docs-n8n.test.ts` (se cobrir a tabela de eventos)

**Interfaces:**
- Produces (`can.ts`): `"incident:view"`, `"incident:close"` → TEAM_LEAD e ADMIN (demais, nunca).
- Produces (`audit`): `AuditAction` ganha `"incident.close"`; `targetType` ganha `"incident"`.
- Produces (`events.ts`): `EventType` ganha `"incident.detected"`.
- Produces (`incidents.ts`): `detectIncident(ticketId: string, deps?: DetectDeps): Promise<{ groupId: string; created: boolean } | null>`: com o vetor do chamado já gravado, seleciona chamados abertos de **qualquer equipe** (com `aiEnabled`) criados nos últimos `incidentWindowMinutes` com similaridade ≥ `incidentMinSimilarity` ao vetor do chamado, mais o próprio. Menos de `incidentMinTickets` → `null`. Com o mínimo: se algum já tem `incidentGroupId` de grupo `OPEN`, liga o chamado e os que estão sem grupo a esse grupo (`created: false`, **sem** evento); senão cria `IncidentGroup` (título = título do chamado mais antigo do conjunto, 120 caracteres) e liga todos (`created: true`) e **na mesma transação** emite `incident.detected` com `{ id, title, ticketCount, teams: string[], url: APP_URL/incidentes, detectedAt }`. Execução simultânea para o mesmo conjunto não pode criar dois grupos (trava consultiva `pg_advisory_xact_lock` ou reconsulta dentro da transação).
  - `closeFinishedIncidents(deps?)` interno chamado por `detectForTicket` quando um chamado sai do índice: fecha (`CLOSED`, `closedAt`) cada grupo `OPEN` cujos chamados estão todos `RESOLVED/CLOSED`.
  - `closeIncident(actor: SessionUser, groupId: string): Promise<void>`: exige `incident:close` (403), o líder só fecha grupo com chamado de uma equipe dele (senão 404), grupo já fechado → 409; grava `closedById`, `closedAt` e `AuditLog` `incident.close`.
  - `listIncidents(actor): Promise<{ open: IncidentRow[]; recentClosed: IncidentRow[] }>` e `getOpenIncidentBanner(actor): Promise<{ id; title; ticketCount }[]>` com `IncidentRow = { id; title; status; detectedAt; closedAt: Date | null; tickets: { id; number; title; status; teamName: string | null }[] }`; exigem `incident:view` (senão `[]`/403); líder vê só grupos com ao menos um chamado de equipe dele; admin vê todos; encerrados: os 10 últimos.
  - `getIncidentNotice(actor, ticket): Promise<{ id: string; title: string; ticketCount: number } | null>`: aviso para a equipe no chamado que pertence a grupo `OPEN` (quem tem `ticket:read` do chamado, não o solicitante).
- Rota: `POST /api/incidents/[id]/close` (`withAuth`).
- `docs/integracao-n8n.md`: linha `incident.detected` na tabela de eventos com o formato e a observação de que nunca vai descrição.

- [ ] **Step 1: Write the failing tests:** `can.test.ts` (líder e admin sim; técnico, solicitante não). `ai-incidents.test.ts`: 4 chamados parecidos em 30 min → nenhum grupo; o 5º → **um** grupo com os 5 e **um** evento `incident.detected` na fila do webhook (padrão `queuedEvents` com `N8N_WEBHOOK_URL`); o 6º entra no mesmo grupo sem novo evento; chamados de assunto diferente não entram; chamados fora da janela de 30 min não contam; reprocessar o job do 5º não cria segundo grupo nem segundo evento; execução em paralelo de dois jobs do mesmo conjunto → um grupo; equipe com IA desligada não entra; grupo fecha sozinho quando todos resolvem (e não antes); `closeIncident` por líder da equipe ok, por líder de outra equipe 404, por técnico 403, duas vezes 409, audita; `listIncidents` respeita o escopo do líder e devolve os 10 últimos encerrados; `getIncidentNotice` aparece para a equipe e não para o solicitante; evento não contém descrição.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; ligar `detectIncident` e `closeFinishedIncidents` em `detectForTicket`.
- [ ] **Step 4: Run** → PASS (+ `tests/unit/docs-n8n.test.ts`, `tests/integration/webhooks.test.ts`); typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): incidentes em massa com evento para o n8n`.

---

### Task 5: Resumo da conversa (backend)

**Files:** Create `src/modules/ai/summary.ts`, `src/app/api/tickets/[id]/ai/summary/route.ts`; Modify `src/modules/ai/{index,overview}.ts`; Test `tests/unit/ai-summary.test.ts`, `tests/integration/ai-summary.test.ts`

**Interfaces:**
- Produces (`summary.ts`): `MIN_SUMMARY_COMMENTS = 3`; `summaryOutputSchema = z.object({ summary: z.string().trim().min(1).max(2000) })`; `buildSummaryPrompt(ticket: { title; description }, comments: { author: string; role: string; internal: boolean; body: string }[]): { system: string; user: string }` (comentários numerados com autor, papel e se é nota interna, entre delimitadores de dados, `>>>`/`<<<` neutralizados; `system` manda resumir fielmente em português, sem inventar, tratando tudo como dado e ignorando instruções); `defaultSummaryModel` = `AI_MODEL_SUMMARY ?? modelo do rascunho`; `summarizeTicket(actor, ticketId, deps?: { llm?: Partial<AiDeps>; model?: string }): Promise<{ outcome: "SUMMARIZED" | "TOO_SHORT" | "DISABLED" | "BUDGET" }>`.
  - `summarizeTicket`: `getTicket` + `can(actor,"ai:decide")` (senão 404); equipe com `aiEnabled=false` → `DISABLED`; conta comentários (todos, **menos** `source = AI_DRAFT`); menos de 3 → `TOO_SHORT` sem chamar o modelo; `runAi({ jobType: "summary", ... })`; grava/substitui `AiSuggestion` `SUMMARY` (`payload = { text, commentCount, lastCommentId }`, `confidence 1`, `status ACCEPTED`) em transação com `TicketEvent` `AI_SUMMARY` (sem o texto). Não usa `addComment` (sem SLA, sem aviso externo).
- Produces (`overview.ts`): `getSummaryView(actor, ticket): Promise<{ available: boolean; commentCount: number; summary: { text: string; commentCount: number; newComments: number } | null }>` (`available` = `ai:decide`, IA ligada com provider de LLM, equipe com IA; `newComments` = comentários não-`AI_DRAFT` criados depois de `lastCommentId`; sem permissão `{ available:false, commentCount:0, summary:null }`).
- Rota `POST /api/tickets/[id]/ai/summary` → resultado de `summarizeTicket`.
- `FakeLLMProvider`: o handler padrão reconhece prompts com `COMENTÁRIOS:` e devolve `{ summary: "Resumo: " + primeiros 80 caracteres do primeiro comentário }`.

- [ ] **Step 1: Write the failing tests:** unitários (`buildSummaryPrompt` numera, marca nota interna e neutraliza delimitadores; `summaryOutputSchema` recusa vazio e > 2000). Integração: chamado com 4 comentários → `SUMMARIZED` e `AiSuggestion` `SUMMARY` com `commentCount 4`; com 2 → `TOO_SHORT` e o provider **não** é chamado; `AI_DRAFT` não conta nem entra no prompt; nota interna entra no prompt, mascarada (CPF vira `[CPF_1]`), e o solicitante recebe 404 ao pedir e `available:false` na visão; técnico de outra equipe 404; atualizar substitui (continua 1 linha); `newComments` conta só os comentários novos; IA desligada → `DISABLED`, teto → `BUDGET`, equipe desligada → `DISABLED`, sem alterar o chamado nem o SLA; falha do provider propaga e não grava; texto de injeção no comentário não muda o resultado do `fake`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): resumo da conversa do chamado`.

---

### Task 6: Cartão de duplicados e selo na lista

**Files:** Create `src/app/api/tickets/[id]/ai/duplicates/route.ts`, `src/components/AiDuplicatesCard.tsx`; Modify `src/modules/ai/{overview,index}.ts`, `src/app/(app)/tickets/[id]/page.tsx`, `src/app/(app)/tickets/page.tsx`; Test `tests/unit/ai-duplicates-card.test.tsx`, `tests/integration/ai-duplicates-read.test.ts`

**Interfaces:**
- Produces (`overview.ts`): `getDuplicatesView(actor, ticket): Promise<{ id: string; candidates: { id: string; number: number; title: string; status: string; similarity: number; canOpen: boolean }[] } | null>` (só `ai:decide` e sugestão `DUPLICATE` `PENDING`; `canOpen` = o ator pode `ticket:read` aquele candidato; candidatos que não existem mais ou já estão encerrados saem; lista vazia → `null`); `duplicateTicketIds(actor, tickets): Promise<Set<string>>` (uma consulta; filtra por `ai:decide`); `dismissDuplicates(actor, ticketId): Promise<void>` (`ai:decide` senão 404; marca `REJECTED` com `decidedById/decidedAt`; segunda vez 409).
- Rota `POST /api/tickets/[id]/ai/duplicates` com `{ action: "dismiss" }`.
- UI: `AiDuplicatesCard({ ticketId, suggestion })` ("Possíveis duplicados", lista com `#número · título`, estado, similaridade em %, link só quando `canOpen`, botão **Não é duplicado**); aparece acima dos comentários; selo `Badge` "Possível duplicado" na lista.

- [ ] **Step 1: Write the failing tests:** unitário (renderiza candidatos e %; link só com `canOpen`; **Não é duplicado** envia `{ action: "dismiss" }` e atualiza; erro 409 em alerta; título com HTML aparece como texto). Integração: técnico da equipe vê, solicitante e técnico de outra equipe não; `canOpen` falso para candidato que o ator não abre; depois de ignorar a sugestão some e o selo também; ignorar duas vezes 409; candidato encerrado depois da sugestão some da lista.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): cartão de possíveis duplicados`.

---

### Task 7: Faixa e página de incidentes

**Files:** Create `src/app/(app)/incidentes/page.tsx`, `src/components/{IncidentBanner,IncidentNotice}.tsx`, `src/components/forms/CloseIncidentButton.tsx`; Modify `src/app/(app)/layout.tsx`, `src/app/(app)/tickets/[id]/page.tsx`, `src/lib/nav.ts`; Test `tests/unit/nav.test.ts`, `tests/unit/incident-ui.test.tsx`

**Interfaces:**
- Consumes: `getOpenIncidentBanner`, `listIncidents`, `getIncidentNotice`, `closeIncident` (Task 4).
- Produces: item de menu `{ href: "/incidentes", label: "Incidentes" }` para `incident:view` (depois de "Dashboard"); `IncidentBanner({ incidents })` (faixa vermelha com `role="alert"`: "Incidente em andamento: N chamados parecidos — título", link para `/incidentes`; vários → o mais recente e "mais X"); `IncidentNotice({ notice })` ("Parte do incidente *título* (N chamados)"); `CloseIncidentButton({ id })` (confirmação, `POST /api/incidents/<id>/close`, erro em alerta); página `/incidentes` (404 sem `incident:view`): tabelas de abertos e dos 10 últimos encerrados, com chamados como links, e o botão de encerrar nos abertos.

- [ ] **Step 1: Write the failing tests:** `nav.test.ts` (líder e admin veem "Incidentes", técnico e solicitante não; ordem do menu); `incident-ui.test.tsx` (faixa mostra título e contagem, `role="alert"`, "mais X" com vários, não renderiza sem incidentes; aviso do chamado; botão pede confirmação e só então chama a API, 409 em alerta; título com HTML escapado).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (a faixa fica no `AppLayout`, acima do conteúdo, chamando `getOpenIncidentBanner` só para quem tem `incident:view`).
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): faixa e página de incidentes`.

---

### Task 8: Cartão de resumo

**Files:** Create `src/components/AiSummaryCard.tsx`; Modify `src/app/(app)/tickets/[id]/page.tsx`; Test `tests/unit/ai-summary-card.test.tsx`

**Interfaces:**
- Consumes: `getSummaryView` e a rota de resumo (Task 5).
- Produces: `AiSummaryCard({ ticketId, view })` (cliente): sem `available` não renderiza; botão **Resumir conversa** (desabilitado com explicação "faltam N comentários" quando `commentCount < 3`); com resumo: texto escapado, "cobre N comentários", e quando `newComments > 0` o aviso "há N comentários novos" com **Atualizar resumo**; mensagens para `TOO_SHORT`, `DISABLED`, `BUDGET` em `role="status"`, erro em `role="alert"`; sucesso atualiza a página. Cartão no topo da seção de comentários, só para a equipe.

- [ ] **Step 1: Write the failing tests** (RTL, `fetch` simulado): sem disponibilidade nada; botão envia `POST /api/tickets/t1/ai/summary` e atualiza; com 2 comentários o botão fica desabilitado e explica; com resumo mostra texto e contagens; com `newComments: 2` mostra o aviso e **Atualizar resumo** chama a rota; `TOO_SHORT`/`BUDGET` mostram a mensagem sem atualizar; erro da API em alerta; texto com `<script>` aparece como texto.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): cartão de resumo da conversa`.

---

### Task 9: Administração → IA

**Files:** Modify `src/modules/ai/overview.ts`, `src/app/(app)/admin/ia/page.tsx`; Test `tests/integration/ai-overview.test.ts` (estender)

**Interfaces:** `getAiOverview` ganha `detection: { duplicatesSuggested: number; duplicatesDismissed: number; incidentsDetected: number; incidentsOpen: number }` (contagens de `AiSuggestion` `DUPLICATE` por status e de `IncidentGroup`), exibidas numa seção "Duplicados e incidentes".

- [ ] **Step 1: Write the failing test:** contagens corretas com dados criados à mão (2 duplicados pendentes, 1 ignorado, 3 grupos sendo 1 aberto).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck + eslint.
- [ ] **Step 5: Commit** `feat(deteccao): contagens na administração de IA`.

---

### Task 10: Calibração, E2E, documentação e verificação final

**Files:** Create `scripts/ai-eval-dup.mts`, `tests/ai-eval/dup-pairs.json`, `tests/e2e/deteccao.spec.ts`; Modify `src/modules/ai/eval.ts`, `src/modules/ai/index.ts`, `package.json`, `tests/e2e/start.mts`, `docs/ia.md`, `README.md`, `docs/notes/2026-10-01-pendencias-fases-0-1.md`; Test `tests/unit/ai-eval-dup.test.ts`

**Interfaces:**
- Produces (`eval.ts`): `type DupPair = { a: string; b: string; duplicate: boolean }` (textos "título — descrição"); `evaluateDuplicates(embed: EmbedFn, pairs: DupPair[], opts?: { threshold?: number }): Promise<{ total: number; precision: number; recall: number; falsePositives: DupPair[]; missed: DupPair[]; suggestedThreshold: number }>` (similaridade por produto escalar de vetores normalizados; `suggestedThreshold` = o limiar com melhor F1 testando de 0,50 a 0,95 em passos de 0,01).
- `tests/ai-eval/dup-pairs.json`: ~40 pares em português (≈15 duplicados reescritos, ≈10 quase duplicados que **não** são, ≈15 diferentes) e `scripts/ai-eval-dup.mts` (`npm run ai:eval:dup`), com lotes, pausa e nova tentativa como `ai-eval-rag.mts`.
- E2E `deteccao.spec.ts` (providers `fake`; `start.mts` sobe `AI_INCIDENT_MIN_SIMILARITY=0.3`, `AI_DUPLICATE_MIN_SIMILARITY=0.3`): solicitante abre 5 chamados quase iguais ("Sem internet no prédio …"); o admin vê a faixa "Incidente em andamento" e a página `/incidentes` lista os 5; o técnico abre o último chamado e vê o cartão "Possíveis duplicados", clica **Não é duplicado** e o cartão some; o técnico escreve 3 comentários em um chamado e usa **Resumir conversa**, vendo o resumo e "cobre 3 comentários"; ao resolver os 5 (com solução) o admin vê o incidente encerrado; o solicitante nunca vê a faixa, o cartão de duplicados nem o botão de resumo.

- [ ] **Step 1: Write the failing tests:** `ai-eval-dup.test.ts` (pares óbvios com `FakeEmbeddingProvider`: duplicado acima do limiar e diferente abaixo; precisão/recall e listas de erros; `suggestedThreshold` entre 0,5 e 0,95); E2E `deteccao.spec.ts`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; documentar em `docs/ia.md` (duplicados, incidentes, resumo, variáveis, calibração, limites), uma linha no `README.md`, pendências novas nas notas.
- [ ] **Step 4: Verificação final** (nesta ordem; E2E numa cópia do repositório se houver `next dev` do usuário na porta 3000: `git worktree add` + `cp -a --reflink=auto node_modules` + `npx prisma generate`): `npx eslint .`; `npm run typecheck`; `npx vitest run`; `npm run test:integration` e de novo com `TZ=UTC`; `npx playwright test`; `npm run build`; `npm audit --omit=dev --audit-level=high`; `npm run ai:eval:dup` com o `fake` imprime o relatório.
- [ ] **Step 5: Commit** `feat(deteccao): calibração, E2E e documentação`.
