# Fase 2.2: Integração com o n8n — Plano de Implementação

Passos com checkbox (`- [ ]`) para acompanhar a execução tarefa por tarefa.

**Goal:** O sistema avisa o n8n de tudo que acontece nos chamados (e de convites e redefinições de senha), com assinatura e retentativa, e o n8n abre chamados e comenta por uma API com chave própria.

**Architecture:** Saída por outbox transacional: `emitEvent(tx, ...)` grava um `WebhookDelivery` e enfileira o envio na mesma transação da mudança; o worker entrega com HMAC e retentativa, e o dead-letter do pg-boss marca FAILED. Entrada por `/api/v1/*` com `Authorization: Bearer`, chaves guardadas como hash, escopos e limite por chave. Módulo novo `src/modules/integrations`, que não importa `tickets` (tickets e auth é que chamam `emitEvent`).

**Tech Stack:** Next.js 16 (Route Handlers), Prisma 7, pg-boss 12 (dead letter, `deleteAfterSeconds`), `node:crypto` (HMAC-SHA256, `timingSafeEqual`), Zod 4, Vitest + Testcontainers, Playwright.

**Spec:** `docs/specs/2026-10-02-fase-2-design.md` (seções 3 "Integração", 6 e 8 item 2).

## Global Constraints

- Destino único: `N8N_WEBHOOK_URL` e `N8N_WEBHOOK_SECRET` (obrigatório e com ≥ 32 caracteres quando a URL existe). Sem URL, o evento só vai para o log (nenhum `WebhookDelivery`, nenhum job).
- Corpo do webhook: `{ id, type, occurredAt, data }`. Cabeçalhos `X-Event-Id`, `X-Timestamp` (segundos Unix) e `X-Signature: sha256=<hex HMAC-SHA256(N8N_WEBHOOK_SECRET, timestamp + "." + corpo)>`.
- Eventos: `ticket.created`, `ticket.assigned`, `ticket.status_changed`, `comment.created` (só públicos), `sla.warning`, `sla.breached` (tipos declarados agora, emitidos no plano 3), `auth.invite_created`, `auth.password_reset_requested`.
- `data` de evento de chamado: id, número, título, status, prioridade, equipe (nome), solicitante e responsável (nome e e-mail), link. **Nunca** descrição nem texto de comentário. Eventos de auth: e-mail, nome (quando existir), link e expiração.
- Entrega: POST com timeout de 10 s; 2xx = DELIVERED; até 8 tentativas com intervalo exponencial; depois FAILED (via dead letter).
- Jobs de webhook ficam no máximo 1 h nas tabelas do pg-boss (`deleteAfterSeconds: 3600`), porque o corpo de eventos de auth leva links com token.
- O transporte de e-mail em log da Fase 1 (`src/modules/notifications`) é removido; convite e reset publicam eventos; a resposta do `forgot` continua idêntica exista ou não a conta.
- Chave de API: formato `gk_<prefixo de 8>_<segredo de 32>` (base64url), guardada só como SHA-256; o segredo aparece uma única vez. Escopos: `tickets:create`, `comments:create`.
- `/api/v1`: 401 chave inexistente/revogada; 403 escopo ausente; 413 corpo > 64 KB; 429 acima de 60 requisições/min por chave; 422 `requester_not_found` para solicitante inexistente ou inativo.
- Idempotência: `externalRef` repetido na mesma chave (chamado) ou no mesmo chamado (comentário) responde 200 com o existente, sem duplicar, inclusive em chamadas simultâneas.
- Toda escrita de chave de API grava `AuditLog` (`apikey.create`, `apikey.revoke`).
- Textos e mensagens em português do Brasil; Next 16: consultar `node_modules/next/dist/docs/` antes de usar API do Next.

## Review Focus

- n8n fora do ar ou lento: a ação do usuário não espera nem falha; o envio tenta de novo e, esgotado, aparece como falha no admin. → Task 3.
- Duas chamadas simultâneas da API com o mesmo `externalRef` (n8n repetindo após timeout): um único chamado. → Task 7.
- Nota interna, descrição do chamado ou texto de comentário nunca aparecem num webhook. → Task 4.
- E-mail do solicitante com maiúsculas diferentes na API (`Ana@X.com`) encontra a conta. → Task 7.
- Chave revogada deixa de funcionar na hora; o segredo não pode ser recuperado depois de criado. → Task 6.

## Estrutura de arquivos

```
prisma/schema.prisma                              # ApiKey, WebhookDelivery, Ticket/Comment: source, apiKeyId, externalRef
src/lib/config.ts                                 # N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET
src/lib/queue.ts                                  # defineQueue com opções
src/modules/integrations/signature.ts            # signPayload, verifySignature (puro)
src/modules/integrations/events.ts               # EventType, emitEvent, payloads
src/modules/integrations/delivery.ts             # deliverWebhook, markFailed, retryDelivery, listFailedDeliveries
src/modules/integrations/api-keys.ts             # createApiKey, listApiKeys, revokeApiKey, authenticateApiKey
src/modules/integrations/inbound.ts              # createTicketFromApi, addCommentFromApi
src/modules/integrations/index.ts
src/lib/http.ts                                   # + withApiKey
src/app/api/v1/tickets/route.ts
src/app/api/v1/tickets/[number]/comments/route.ts
src/app/api/admin/api-keys/route.ts, [id]/route.ts
src/app/api/admin/webhooks/[id]/retry/route.ts
src/app/(app)/admin/integracoes/page.tsx
src/components/admin/ApiKeyForm.tsx
docs/integracao-n8n.md
```

---

### Task 1: Schema e configuração

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/config.ts`, `.env.example`
- Create: `prisma/migrations/20261002000200_integracao/migration.sql`
- Test: `tests/integration/schema-integracao.test.ts`, `tests/unit/config.test.ts`

**Interfaces:**
- Produces:
  - `enum TicketSource { WEB API }`; `Ticket.source TicketSource @default(WEB)`, `Ticket.apiKeyId String?` (FK `ApiKey`), `Ticket.externalRef String?`, `@@unique([apiKeyId, externalRef])`.
  - `CommentSource` ganha `API`; `Comment.externalRef String?`, `@@unique([ticketId, externalRef])`.
  - `ApiKey { id, name, prefix @unique, keyHash @unique, scopes String[], createdById (FK User), createdAt, lastUsedAt?, revokedAt? }`.
  - `enum DeliveryStatus { PENDING DELIVERED FAILED }`; `WebhookDelivery { id, eventId @unique, type, ticketId?, subjectId? (ex.: id do comentário), status @default(PENDING), attempts Int @default(0), lastError String?, createdAt, deliveredAt? }` com índice `(status, createdAt)`.
  - `Config.N8N_WEBHOOK_URL?: string` (URL http/https) e `Config.N8N_WEBHOOK_SECRET?: string`; com URL definida, segredo ausente ou com menos de 32 caracteres lança citando `N8N_WEBHOOK_SECRET`.

- [ ] **Step 1: Write the failing tests**
  - `schema-integracao.test.ts`: cria `ApiKey` e dois chamados com o mesmo `(apiKeyId, externalRef)` → o segundo viola unicidade; mesmo `externalRef` com `apiKeyId` diferente é permitido; dois comentários com o mesmo `(ticketId, externalRef)` → violação; `WebhookDelivery` grava com `status` PENDING e `attempts` 0.
  - `config.test.ts`: sem URL, sem segredo → ok; URL `http://n8n.local/webhook/x` sem segredo → lança `/N8N_WEBHOOK_SECRET/`; com segredo de 32 caracteres → ok; URL inválida → lança `/N8N_WEBHOOK_URL/`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/config.test.ts` e `npx vitest run --config vitest.integration.config.mts tests/integration/schema-integracao.test.ts` → FAIL.
- [ ] **Step 3: Implement**; migration com `prisma migrate diff --from-schema <schema do HEAD> --to-schema prisma/schema.prisma --script`; `.env.example` com `N8N_WEBHOOK_URL=` e `N8N_WEBHOOK_SECRET=` comentados.
- [ ] **Step 4: Run** → PASS; `npm run test:integration` inteiro verde.
- [ ] **Step 5: Commit** `feat: schema de chaves de API, entregas de webhook e origem de chamados`.

### Task 2: Assinatura HMAC e filas configuráveis

**Files:**
- Create: `src/modules/integrations/signature.ts`
- Modify: `src/lib/queue.ts`
- Test: `tests/unit/signature.test.ts`, `tests/integration/queue.test.ts`

**Interfaces:**
- Produces:
  - `signPayload(secret: string, timestamp: number, body: string): string` → `"sha256=" + hex`.
  - `verifySignature(input: { secret: string; timestamp: number; body: string; signature: string; now?: number; toleranceSeconds?: number }): boolean` (padrão 300 s; comparação em tempo constante).
  - `defineQueue(name: string, options: { retryLimit?: number; retryDelay?: number; retryBackoff?: boolean; deleteAfterSeconds?: number; deadLetter?: string }): Promise<void>` em `src/lib/queue.ts`; `enqueue`/`registerHandler` passam a respeitar uma fila já definida (o `ensureQueue` atual só cria com o padrão quando a fila não foi definida).

- [ ] **Step 1: Write the failing tests**
  - `signature.test.ts`: `signPayload("s".repeat(32), 1790000000, '{"a":1}')` é igual ao `createHmac` calculado no teste; `verifySignature` aceita a assinatura certa; recusa corpo alterado, segredo errado, timestamp 301 s no passado e assinatura com tamanho diferente (sem lançar).
  - `queue.test.ts`: `defineQueue("teste.dlq-origem", { retryLimit: 0, deadLetter: "teste.dlq" })`, handler que sempre lança e handler em `teste.dlq` → o job chega ao dead letter com o mesmo `data`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/signature.test.ts` e o `queue.test.ts` de integração → FAIL.
- [ ] **Step 3: Implement.** O dead letter precisa existir antes da fila de origem (`createQueue` do dead letter primeiro).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(integrations): assinatura HMAC e filas com dead letter`.

### Task 3: `emitEvent` e entrega dos webhooks

**Files:**
- Create: `src/modules/integrations/events.ts`, `src/modules/integrations/delivery.ts`, `src/modules/integrations/index.ts`
- Modify: `src/worker/index.ts`
- Test: `tests/integration/webhooks.test.ts`, `tests/integration/helpers/webhook-server.ts`

**Interfaces:**
- Consumes: `signPayload`, `defineQueue`, `enqueue(..., { tx })`, `registerHandler`.
- Produces:
  - `type EventType = "ticket.created" | "ticket.assigned" | "ticket.status_changed" | "comment.created" | "sla.warning" | "sla.breached" | "auth.invite_created" | "auth.password_reset_requested"`.
  - `emitEvent(tx: Prisma.TransactionClient, type: EventType, data: Record<string, unknown>, ref?: { ticketId?: string; subjectId?: string }): Promise<string | null>`: com `N8N_WEBHOOK_URL` definida, cria `WebhookDelivery` (eventId = `randomUUID()`) e enfileira `webhook.deliver` com `{ deliveryId, body }`, onde `body` é o JSON final `{ id, type, occurredAt, data }`; devolve o `eventId`. Sem URL, registra no log e devolve `null`.
  - `registerWebhookQueues(opts?: { retryLimit?: number; retryDelay?: number }): Promise<void>`: define `webhook.failed` e `webhook.deliver` (padrão `retryLimit: 7` = 8 tentativas, `retryDelay: 30`, `retryBackoff: true`, `deleteAfterSeconds: 3600`, `deadLetter: "webhook.failed"`) e registra os handlers.
  - `deliverWebhook(job: { deliveryId: string; body: string }): Promise<void>`: POST com `X-Event-Id`, `X-Timestamp`, `X-Signature`, `content-type: application/json` e timeout de 10 s (`AbortSignal.timeout`); 2xx → `DELIVERED` + `deliveredAt`; outra resposta ou erro → incrementa `attempts`, grava `lastError` (status e até 200 caracteres) e lança para o pg-boss tentar de novo.
  - Handler de `webhook.failed`: marca `FAILED`.
  - Worker chama `registerWebhookQueues()` no boot.
  - Helper de teste `startWebhookServer(handler?: (req) => number): Promise<{ url: string; received: { headers: Record<string,string>; body: string }[]; close(): Promise<void> }>` com `node:http`.

- [ ] **Step 1: Write the failing tests** (`webhooks.test.ts`, com `registerWebhookQueues({ retryLimit: 2, retryDelay: 1 })` e `N8N_WEBHOOK_URL` apontando para o servidor de teste)
  - Evento emitido numa transação confirmada chega uma vez, com `X-Signature` que `verifySignature` aceita usando o segredo do teste; `WebhookDelivery` fica `DELIVERED`.
  - Evento emitido numa transação com rollback não chega e não deixa `WebhookDelivery`.
  - Servidor responde 500 na primeira vez e 200 na segunda → chega na segunda tentativa; `attempts` = 1 e status DELIVERED.
  - Servidor sempre 500 → `WebhookDelivery` termina `FAILED` com `lastError` contendo `500`.
  - Sem `N8N_WEBHOOK_URL`, `emitEvent` devolve `null` e não cria `WebhookDelivery`.
  - Servidor que demora 15 s → a tentativa falha por timeout (com `retryLimit: 0` no teste) e a chamada a `emitEvent` retornou em menos de 1 s.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/webhooks.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(integrations): eventos com outbox transacional e entrega assinada com retentativa`.

### Task 4: Eventos de chamado ligados ao domínio

**Files:**
- Modify: `src/modules/integrations/events.ts`, `src/modules/tickets/service.ts`, `src/modules/tickets/assignment.ts`, `src/modules/tickets/resolution.ts`, `src/modules/tickets/comments.ts`
- Test: `tests/integration/ticket-events.test.ts`

**Interfaces:**
- Produces: `ticketEventData(tx, ticketId: string): Promise<TicketEventData>` em `events.ts`, com `TicketEventData = { id, number, title, status, priority, team: string | null, requester: { name, email }, assignee: { name, email } | null, url }` (`url` = `APP_URL/tickets/<id>`).
- Chamadas de `emitEvent` dentro das transações existentes:
  - `createTicket` → `ticket.created`.
  - `assignTicket`, `takeTicket`, `releaseAssignments` (um por chamado) → `ticket.assigned` com `{ ...TicketEventData, previousAssigneeId }`.
  - `applyStatus`, `reopenTicket`, `confirmTicket`, `autoCloseResolved` (um por chamado) → `ticket.status_changed` com `{ ...TicketEventData, from, to }`.
  - `addComment` com `internal: false` e o comentário do `reopenTicket` → `comment.created` com `{ ticket: TicketEventData, commentId, author: { name, email } }`.

- [ ] **Step 1: Write the failing tests** (consultam a tabela `pgboss.job` com SQL parametrizado para ler o `body` enfileirado em `webhook.deliver`; helper `queuedEvents(type?)` no próprio teste)
  - Criar, atribuir, assumir, mudar status, reabrir, confirmar e fechar automaticamente enfileiram o tipo esperado com `data.number` e `data.url` corretos.
  - Comentário interno não enfileira nada; comentário público enfileira `comment.created`.
  - Nenhum corpo enfileirado contém a descrição do chamado nem o texto de qualquer comentário (assert por substring nos corpos).
  - Transição recusada (409) não enfileira evento.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/ticket-events.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run test:integration` inteiro verde.
- [ ] **Step 5: Commit** `feat(integrations): avisos de chamado para o n8n`.

### Task 5: Convite e redefinição de senha por evento

**Files:**
- Modify: `src/modules/auth/invite.ts`, `src/modules/auth/reset.ts`, `tests/integration/invite-reset.test.ts`
- Delete: `src/modules/notifications/index.ts`

**Interfaces:**
- Consumes: `emitEvent` (Task 3).
- Produces: `createInvite` publica `auth.invite_created` `{ email, role, url, expiresAt }` na mesma transação; `requestReset` publica `auth.password_reset_requested` `{ email, name, url, expiresAt }` numa transação junto com a criação do `PasswordReset`.

- [ ] **Step 1: Write the failing tests** — reescrever as partes de `invite-reset.test.ts` que liam `mails` para lerem o token do corpo enfileirado (`queuedEvents("auth.password_reset_requested")`), mantendo todas as asserções atuais; acrescentar: e-mail inexistente no `requestReset` não enfileira nada e a rota `forgot` responde igual nos dois casos; `createInvite` enfileira `auth.invite_created` com o link que `acceptInvite` aceita.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/invite-reset.test.ts` → FAIL.
- [ ] **Step 3: Implement** e apagar o módulo `notifications`.
- [ ] **Step 4: Run** → PASS; `grep -rn "notifications" src tests` sem resultados.
- [ ] **Step 5: Commit** `feat(auth): convite e redefinição de senha avisados pelo n8n`.

### Task 6: Chaves de API

**Files:**
- Create: `src/modules/integrations/api-keys.ts`, `src/app/api/admin/api-keys/route.ts`, `src/app/api/admin/api-keys/[id]/route.ts`
- Modify: `src/modules/audit/index.ts` (`AuditAction` + `"apikey.create" | "apikey.revoke"`, `targetType` + `"apikey"`), `src/modules/integrations/index.ts`
- Test: `tests/integration/api-keys.test.ts`

**Interfaces:**
- Produces:
  - `type ApiScope = "tickets:create" | "comments:create"`.
  - `createApiKey(actor, input: { name: string; scopes: ApiScope[] }): Promise<{ id: string; key: string; prefix: string }>` (só ADMIN; grava `apikey.create`).
  - `listApiKeys(actor): Promise<{ id, name, prefix, scopes, createdAt, lastUsedAt, revokedAt }[]>` (nunca hash nem segredo).
  - `revokeApiKey(actor, id): Promise<void>` (grava `apikey.revoke`; já revogada → sem erro).
  - `authenticateApiKey(authorization: string | null, scope: ApiScope): Promise<{ id: string; name: string }>`: formato inválido, prefixo desconhecido, hash diferente ou revogada → `AppError(401, "Chave de API inválida.")`; escopo ausente → `AppError(403, ...)`; atualiza `lastUsedAt`.
  - Rotas (com `withAdmin`): `GET/POST /api/admin/api-keys` (POST devolve `{ key, prefix }` uma vez, 201) · `DELETE /api/admin/api-keys/[id]`.

- [ ] **Step 1: Write the failing tests**
  - Chave criada autentica com o escopo concedido e recebe 403 com o outro; `lastUsedAt` é preenchido.
  - Revogar → próxima autenticação 401.
  - `listApiKeys` e o JSON da rota GET não contêm o segredo nem `keyHash` (assert por substring da chave inteira e do hash).
  - Cabeçalho ausente, sem `Bearer`, com prefixo existente e segredo errado → 401 com a mesma mensagem.
  - Não-admin nas rotas → 403; criação e revogação geram `AuditLog`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/api-keys.test.ts` → FAIL.
- [ ] **Step 3: Implement** (segredo com `randomBytes(24).toString("base64url")`, prefixo com `randomBytes(6).toString("base64url")`, comparação com `timingSafeEqual` sobre os hashes).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(integrations): chaves de API com escopo e auditoria`.

### Task 7: API de entrada `/api/v1`

**Files:**
- Create: `src/modules/integrations/inbound.ts`, `src/app/api/v1/tickets/route.ts`, `src/app/api/v1/tickets/[number]/comments/route.ts`
- Modify: `src/lib/http.ts`, `src/modules/tickets/service.ts`, `src/modules/tickets/comments.ts`
- Test: `tests/integration/api-v1.test.ts`

**Interfaces:**
- Consumes: `authenticateApiKey` (Task 6); `createTicket`, `addComment`.
- Produces:
  - `withApiKey(scope: ApiScope, handler: (ctx: { req: Request; apiKey: { id: string; name: string }; params: P }) => Promise<Response>)` em `src/lib/http.ts`: autentica, aplica `checkRateLimit("apikey:<id>", 60, 60)` (429), converte erros como `withAuth`.
  - `createTicket(actor, input, origin?: { source: "API"; apiKeyId: string; apiKeyName: string; externalRef?: string })`: grava `source`, `apiKeyId`, `externalRef` e `TicketEvent.data.via = apiKeyName`.
  - `addComment(actor, ticketId, input, origin?: { source: "API"; externalRef?: string })`.
  - `createTicketFromApi(apiKey, input: { requesterEmail: string; title: string; description: string; categoryName?: string; priority?: Priority; externalRef?: string }): Promise<{ ticket: { id; number; url }; created: boolean }>`: solicitante por e-mail em minúsculas, ativo, senão `AppError(422, "requester_not_found")`; categoria raiz por nome sem diferenciar maiúsculas, inexistente é ignorada; `externalRef` existente para a chave → devolve o existente (`created: false`); violação de unicidade em corrida (P2002) → relê e devolve o existente.
  - `addCommentFromApi(apiKey, ticketNumber: number, input: { authorEmail: string; body: string; externalRef?: string }): Promise<{ comment: { id }; created: boolean }>`: autor ativo por e-mail que satisfaça `can(autor, "comment:create", chamado)`, senão 403; chamado inexistente → 404; só público; idempotente por `(ticketId, externalRef)`.
  - Rotas: `POST /api/v1/tickets` (201 novo, 200 existente) · `POST /api/v1/tickets/[number]/comments` (201/200).

- [ ] **Step 1: Write the failing tests**
  - Criação com `requesterEmail: "Ana@X.com"` para a conta `ana@x.com` → 201 com `number` e `url`; o chamado tem `source: "API"`, `apiKeyId` e evento CREATED com `via` = nome da chave.
  - E-mail desconhecido e conta desativada → 422 `{ error: "requester_not_found" }`.
  - Mesmo `externalRef` duas vezes em sequência → 201 e 200 com o mesmo `id`; cinco chamadas simultâneas (`Promise.all`) com o mesmo `externalRef` → um único chamado no banco.
  - `categoryName: "rede"` usa a categoria "Rede" e sua equipe padrão; categoria inexistente → chamado criado na equipe de entrada.
  - Comentário de solicitante no próprio chamado → 201 `source: API`; autor sem acesso → 403; número inexistente → 404; `externalRef` repetido → 200 sem duplicar.
  - Sem chave → 401; chave só com `comments:create` criando chamado → 403; corpo de 70 KB → 413; 61ª requisição no minuto → 429.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/api-v1.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run test:integration` inteiro verde.
- [ ] **Step 5: Commit** `feat(api): entrada de chamados e comentários pelo n8n`.

### Task 8: Tela de integrações e reenvio

**Files:**
- Create: `src/app/(app)/admin/integracoes/page.tsx`, `src/components/admin/ApiKeyForm.tsx`, `src/app/api/admin/webhooks/[id]/retry/route.ts`
- Modify: `src/modules/integrations/delivery.ts`, `src/app/(app)/admin/layout.tsx` (aba "Integrações")
- Test: `tests/integration/webhook-retry.test.ts`

**Interfaces:**
- Produces:
  - `listFailedDeliveries(actor, limit = 50): Promise<{ id, eventId, type, ticketNumber: number | null, attempts, lastError, createdAt }[]>` (só ADMIN).
  - `retryDelivery(actor, deliveryId): Promise<void>` (só ADMIN): só para eventos de chamado; reconstrói o corpo com `ticketEventData` do estado atual, mesmo `eventId` e `data.redelivery: true`, volta a `PENDING` e enfileira; eventos `auth.*` → `AppError(409, "Este aviso não pode ser reenviado. Gere um novo convite ou link.")`; `DELIVERED` → 409.
  - Página: status do n8n ("Configurado" quando `N8N_WEBHOOK_URL` existe, sem exibir URL completa nem segredo; mostra só o host), chaves (criar com nome e escopos, segredo exibido uma vez com "Copiar", revogar), falhas recentes com "Reenviar".

- [ ] **Step 1: Write the failing tests**
  - `retryDelivery` de um `comment.created` FAILED volta a PENDING, enfileira corpo com o mesmo `id` e `redelivery: true`, e o servidor de teste recebe.
  - `retryDelivery` de `auth.password_reset_requested` → 409; de entrega DELIVERED → 409; não-admin → 403.
  - `listFailedDeliveries` traz só FAILED, mais recentes primeiro.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/webhook-retry.test.ts` → FAIL.
- [ ] **Step 3: Implement** serviço, rota e tela.
- [ ] **Step 4: Run** → PASS; typecheck e lint limpos; no navegador: criar chave, copiar, revogar; com um destino que responde 500, ver a falha listada e reenviar.
- [ ] **Step 5: Commit** `feat(ui): tela de integrações (n8n, chaves de API e reenvio)`.

### Task 9: Documentação da integração

**Files:**
- Create: `docs/integracao-n8n.md`, `docs/n8n/email-vira-chamado.json`
- Modify: `README.md` (link na seção de visão geral)
- Test: `tests/unit/docs-n8n.test.ts`

**Interfaces:**
- Produces: documentação em português com: configuração (`N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, criar chave no admin); lista de eventos com um exemplo de corpo de cada; trecho JavaScript para um nó Code do n8n que verifica `X-Signature` e `X-Timestamp`; aviso para não registrar links de convite e reset em log nem em planilhas; referência de `POST /api/v1/tickets` e de comentários com exemplos e códigos de erro; workflow de exemplo "e-mail vira chamado" (gatilho IMAP/Gmail → filtro de autorresposta pelos cabeçalhos `Auto-Submitted` e `Precedence` → HTTP Request com `externalRef` = Message-ID).

- [ ] **Step 1: Write the failing test** `docs-n8n.test.ts`: extrai do `docs/integracao-n8n.md` o bloco de código marcado `js verificar-assinatura`, executa-o com `new Function` sobre um corpo assinado por `signPayload` e espera `true`; com o corpo alterado espera `false`; `docs/n8n/email-vira-chamado.json` é JSON válido e contém um nó HTTP Request apontando para `/api/v1/tickets`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/docs-n8n.test.ts` → FAIL.
- [ ] **Step 3: Write** a documentação e o workflow.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `docs: guia de integração com o n8n e workflow de exemplo`.

### Task 10: E2E da integração

**Files:**
- Create: `tests/e2e/integracao.spec.ts`

**Interfaces:**
- Consumes: seed demo; telas e rotas das Tasks 6–8.

- [ ] **Step 1: Write the failing test**
  - Admin abre `/admin/integracoes`, cria a chave "n8n e-mail" com `tickets:create`, lê o segredo exibido.
  - O teste (fazendo o papel do n8n) chama `POST /api/v1/tickets` com a chave, `requesterEmail: "solicitante@demo.test"`, categoria "Acessos" (equipe Suporte N1) e `externalRef` único → 201; repete a chamada → 200 com o mesmo número.
  - O agente demo filtra "Minha equipe", abre o chamado, vê a origem "API" no detalhe e clica "Assumir".
  - Admin revoga a chave; nova chamada à API → 401.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/integracao.spec.ts` → FAIL.
- [ ] **Step 3: Implement** o que o teste revelar (incluindo exibir a origem do chamado no detalhe: "Aberto via API (<nome da chave>)").
- [ ] **Step 4: Run** `npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `test: E2E da integração (chave, API e revogação)`.

---

## Auto-revisão

- **Cobertura do spec:** seção 3 "Integração" (Task 1); seção 6 saída (Tasks 2–5), entrada (Tasks 6–7), documentação (Task 9); seção 4 "Integrações" do admin (Task 8); seção 8 item 2 e E2E da seção 9 (Task 10). `sla.warning`/`sla.breached` declarados na Task 3 e emitidos no plano 3.
- **Decisões que detalham o spec:** o corpo dos webhooks vive só no job do pg-boss por até 1 h (o spec diz que o `WebhookDelivery` não guarda o corpo); por isso o reenvio reconstrói o corpo do estado atual e não vale para `auth.*`. `WebhookDelivery` ganha `subjectId` para reconstruir `comment.created`.
- **Consistência de tipos:** `EventType`, `emitEvent`, `ticketEventData`, `ApiScope`, `authenticateApiKey`, `withApiKey`, `createTicketFromApi`, `addCommentFromApi`, `retryDelivery` com os mesmos nomes onde são consumidos.
- **Review Focus:** n8n fora do ar → Task 3; `externalRef` simultâneo → Task 7; dados sensíveis fora do payload → Task 4; e-mail com maiúsculas → Task 7; chave revogada e segredo único → Task 6.
