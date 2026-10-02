# Fase 2: gestão, integração com n8n, SLA e dashboard — Design

Data: 2026-10-02 · Status: aguardando revisão · Spec base: `docs/specs/2026-10-01-glpi-ia-design.md`

## 1. Objetivo

Permitir que a empresa opere o fluxo básico sem o GLPI: cadastrar a equipe real, receber chamados pela tela ou por automações do n8n (ex.: e-mail), cumprir prazos de atendimento e acompanhar a operação num dashboard.

**Sucesso:**
- O admin cadastra usuários, equipes e categorias pela tela.
- Convites e redefinições de senha chegam às pessoas via n8n.
- Uma automação do n8n transforma e-mail em chamado pela API, sem duplicar.
- Cada chamado tem prazo de 1ª resposta e de resolução em horário comercial, com alerta antes de vencer.
- Gestor e diretoria acompanham fila, SLA e volume no dashboard.
- Material do post 2 do LinkedIn: GIF "e-mail vira chamado via n8n" e o dashboard.

**Decisões já tomadas com o usuário:**
- Notificações saem pelo **n8n**, que a empresa já usa. O sistema não terá SMTP nem IMAP próprios.
- O n8n **recebe avisos e também cria chamados e comentários** pela API.
- **SLA padrão editável**, sem SLA formal prévio, contado em horário comercial e pausado em Pendente.
- O dashboard atende **o gestor no dia a dia e a diretoria no mês**.

## 2. Abordagens escolhidas

| Decisão | Escolha | Alternativa descartada |
|---|---|---|
| Cálculo do SLA | Prazos gravados no chamado e recalculados nas transições | Cálculo a partir dos eventos a cada consulta (caro em volume) |
| Avisos ao n8n | Outbox transacional no pg-boss, com retentativa | Chamada síncrona na requisição (n8n fora do ar trava o usuário) |
| Entrada do n8n | Chaves de API com escopo, guardadas como hash | Usuário de serviço com sessão |
| Dados do dashboard | Consultas agregadas com cache de 60 s | Tabelas pré-agregadas (desnecessário no volume atual) |

## 3. Modelo de dados (acréscimos)

**SLA**
- `SlaPolicy`: `priority` (único), `firstResponseMinutes`, `resolutionMinutes` (minutos úteis). Seed:

| Prioridade | 1ª resposta | Resolução |
|---|---|---|
| CRITICAL | 60 | 240 |
| HIGH | 120 | 480 |
| MEDIUM | 240 | 1440 |
| LOW | 480 | 2400 |

- `BusinessHours`: `weekday` (0–6, único), `startMinute`, `endMinute`. Seed: segunda a sexta, 480–1080 (8h–18h); sábado e domingo sem expediente.
- `Holiday`: `date` (único, tipo data), `name`. Seed: feriados nacionais fixos e móveis (Carnaval segunda e terça, Sexta-feira Santa, Corpus Christi) do ano corrente e dos 2 seguintes.
- Fuso: `APP_TIMEZONE`, padrão `America/Sao_Paulo`.
- `Ticket` ganha:
  - `slaFirstResponseMinutes`, `slaResolutionMinutes`: cópia da política no momento da criação ou da mudança de prioridade.
  - `firstResponseDue`, `resolutionDue`: prazos gravados.
  - `firstRespondedAt`.
  - `pausedAt`, `pausedMinutes` (minutos úteis acumulados).
  - `firstResponseBusinessMinutes`, `resolutionBusinessMinutes`: tempos reais em minutos úteis, já sem as pausas, gravados no momento da resposta e da resolução.
  - `slaWarnedAt`, `slaBreachedAt`: marcam que o alerta já foi publicado.
  - Índice parcial em `resolutionDue` para chamados que não estão em RESOLVED nem CLOSED.

**Integração**
- `Ticket.source` (`WEB` | `API`), `Ticket.apiKeyId`, `Ticket.externalRef`. Unicidade de `(apiKeyId, externalRef)`.
- `CommentSource` ganha `API`. `Comment.externalRef`, com unicidade de `(ticketId, externalRef)`.
- `ApiKey`: `name`, `prefix` (único, visível), `keyHash`, `scopes` (lista), `createdById`, `createdAt`, `lastUsedAt`, `revokedAt`.
- `WebhookDelivery`: `eventId` (único), `type`, `ticketId` opcional, `status` (`PENDING` | `DELIVERED` | `FAILED`), `attempts`, `lastError`, `createdAt`, `deliveredAt`. O corpo enviado não é guardado.
- Destino único por ambiente: `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`.

**Gestão**
- `AuditLog`: `actorId`, `action`, `targetType`, `targetId`, `data` (JSON), `createdAt`. Registra convites, mudança de papel, ativação e desativação, equipes, categorias, SLA, calendário e chaves de API.
- Fechamento automático: `AUTO_CLOSE_DAYS`, padrão 7 dias corridos em RESOLVED.

## 4. Gestão e telas

**Área `/admin`, só ADMIN.** Toda escrita gera `AuditLog`.
- **Usuários:**
  - Lista com papel e status.
  - Convidar: gera o link na tela e publica `auth.invite_created`.
  - Mudar papel. Desativar revoga as sessões na hora. Reativar.
  - Convites pendentes, com reenviar e revogar. Um convite novo para o mesmo e-mail invalida os pendentes anteriores.
- **Equipes e categorias:** criar e renomear equipe; adicionar e remover membros; criar categoria e definir a equipe padrão.
- **SLA:** editar a política por prioridade, o expediente por dia da semana e os feriados.
- **Integrações:**
  - Criar chave de API: o segredo aparece uma única vez; a lista mostra só o prefixo.
  - Revogar chave.
  - Indicar se `N8N_WEBHOOK_URL` está definida, sem nunca exibir o segredo.
  - Listar entregas FAILED, com "reenviar".

**Detalhe do chamado**
- **Líder e admin:** trocam equipe e responsável. O responsável precisa ser AGENT, TEAM_LEAD ou ADMIN ativo e membro da equipe do chamado; caso contrário a resposta é 400.
- **Técnico:** "Assumir" um chamado da própria equipe que esteja sem responsável.
- **Equipe (AGENT ou superior com acesso):** muda prioridade e categoria. A prioridade recalcula o SLA.
- **Solicitante, com o chamado em RESOLVED:**
  - "Reabrir" exige motivo, que vira comentário público, e leva a OPEN.
  - "Confirmar fechamento" leva a CLOSED.
  - Sem ação, o job `tickets.auto_close` fecha o chamado após `AUTO_CLOSE_DAYS`.
- Badge de SLA: em dia, em risco (≥ 80% do tempo consumido) ou vencido, com o tempo restante ou excedido.

**Lista de chamados**
- Filtros rápidos: "Atribuídos a mim", "Minha equipe", "Abertos por mim", "Vencendo" (em risco) e "Vencidos".
- Ordenação "vence primeiro" (`resolutionDue` crescente, sem prazo por último), padrão para AGENT e superiores.

**Permissões novas no `can()`**
- `ticket:take`: AGENT ou TEAM_LEAD da equipe do chamado, quando não há responsável.
- `ticket:reopen` e `ticket:confirm`: o solicitante do chamado, só em RESOLVED.
- `admin:manage`: só ADMIN.
- `dashboard:view`: TEAM_LEAD (só as próprias equipes) e ADMIN.

**Pendências da Fase 1 resolvidas nesta fase**
- PATCH com campos e status numa única transação.
- Equipe, categoria ou responsável inexistente responde 400, não 500.
- Aviso de build "Dynamic filesystem access" em `attachments.ts`.
- Extensão `.jpeg` aceita nos anexos.
- Convites pendentes invalidados ao reenviar.

## 5. Motor de SLA

**`src/modules/sla/calendar.ts`, funções puras:**
- `addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date`
- `businessMinutesBetween(a: Date, b: Date, cal: BusinessCalendar): number`
- `BusinessCalendar = { timeZone: string; hours: Map<weekday, { start: number; end: number }>; holidays: Set<"YYYY-MM-DD"> }`
- O fuso é tratado com `@date-fns/tz`. Um início fora do expediente passa a contar no começo do próximo intervalo útil.

**`src/modules/sla/holidays.ts`:** cálculo da Páscoa e dos feriados nacionais (fixos e móveis) de um ano.

**`src/modules/sla/service.ts`:** carrega o calendário do banco com cache de 5 min, invalidado quando o admin edita. Regras:
- **Prazo** = `addBusinessMinutes(createdAt, minutosDaPolítica + pausedMinutes)`, sempre recalculado a partir da criação.
- **Ao criar:** copia os minutos da política e grava os dois prazos.
- **Ao entrar em PENDING:** grava `pausedAt`.
- **Ao sair de PENDING:** soma `businessMinutesBetween(pausedAt, agora)` a `pausedMinutes`, limpa `pausedAt` e recalcula os prazos.
- **Ao ir para RESOLVED:** grava `resolutionBusinessMinutes` e marca `pausedAt` (o tempo resolvido conta como pausa).
- **Ao reabrir (RESOLVED → OPEN):** soma a pausa, recalcula os prazos e zera `slaWarnedAt`/`slaBreachedAt`.
- **Ao mudar a prioridade:** copia os minutos da nova política e recalcula os prazos, mantendo `pausedMinutes`.
- **Primeiro comentário público** de AGENT ou superior que não seja o solicitante: grava `firstRespondedAt` e `firstResponseBusinessMinutes`. Nota interna não conta.
- **Sem política para a prioridade:** o chamado fica sem prazo, com log de aviso.
- **Editar a política** não altera chamados já abertos.

**Qual prazo vale para quê:** o estado do badge (em dia, em risco, vencido), os filtros "Vencendo"/"Vencidos" e os alertas usam o **prazo de resolução**. O prazo de 1ª resposta aparece no detalhe do chamado e entra nas métricas do dashboard.

**Job `sla.scan`** (agendado no pg-boss a cada 5 min):
- Publica `sla.warning` para chamados com ≥ 80% do prazo de resolução consumido e `slaWarnedAt` vazio.
- Publica `sla.breached` para chamados com o prazo de resolução vencido e `slaBreachedAt` vazio.
- Marca o campo correspondente na mesma transação.

## 6. Integração com o n8n

**Saída** (`src/modules/integrations/events.ts`, `webhook.ts`)
- `emitEvent(tx, type, data)` cria o `WebhookDelivery` e enfileira `webhook.deliver` na mesma transação. Sem `N8N_WEBHOOK_URL`, o evento só vai para o log.
- **Eventos:**
  - `ticket.created`, `ticket.assigned`, `ticket.status_changed`;
  - `comment.created`, só comentários públicos;
  - `sla.warning`, `sla.breached`;
  - `auth.invite_created`, `auth.password_reset_requested`.
- **Corpo:** `{ id, type, occurredAt, data }`.
  - Eventos de chamado: `data` com id, número, título, status, prioridade, equipe, nome e e-mail do solicitante e do responsável, e o link do chamado. Nunca descrição nem texto de comentário.
  - Eventos de autenticação: e-mail, nome, link e expiração.
- **Cabeçalhos:** `X-Event-Id`, `X-Timestamp` e `X-Signature: sha256=<hex HMAC-SHA256(N8N_WEBHOOK_SECRET, timestamp + "." + corpo)>`.
- **Entrega:**
  - POST com timeout de 10 s.
  - Respostas 2xx marcam DELIVERED.
  - Até 8 tentativas com intervalo exponencial; depois, FAILED.
  - "Reenviar" no admin enfileira de novo com o mesmo `eventId`.
- **O transporte de e-mail da Fase 1 (log) é removido:**
  - Reset de senha e convite passam a publicar eventos.
  - A resposta do `forgot` continua idêntica, exista ou não a conta.

**Entrada** (`/api/v1`, `src/modules/integrations/api-keys.ts`)
- **Autenticação e limites:**
  - `Authorization: Bearer gk_<prefixo>_<segredo>`, com busca pelo prefixo e comparação do SHA-256 em tempo constante.
  - Chave inexistente ou revogada responde 401; escopo ausente, 403.
  - Limite de 60 requisições/min por chave (429) e corpo de até 64 KB (413).
  - Atualiza `lastUsedAt`.
- **`POST /api/v1/tickets`** (escopo `tickets:create`): `{ requesterEmail, title, description, categoryName?, priority?, externalRef? }`.
  - Solicitante inexistente ou inativo responde 422 `requester_not_found`.
  - Categoria inexistente é ignorada (o chamado vai para a equipe de entrada).
  - Sucesso responde 201 `{ id, number, url }`, com `source = API`.
  - O `TicketEvent` registra o nome da chave.
  - Mesmo `externalRef` para a mesma chave responde 200 com o chamado existente, sem duplicar.
- **`POST /api/v1/tickets/{number}/comments`** (escopo `comments:create`): `{ authorEmail, body, externalRef? }`.
  - O autor precisa satisfazer `can(autor, "comment:create", chamado)`; senão, 403.
  - Só comentários públicos.
  - `externalRef` repetido no mesmo chamado responde 200 com o comentário existente.
- **Documentação** `docs/integracao-n8n.md`: exemplos de cada evento, verificação da assinatura num nó Code do n8n, aviso para não registrar links de convite e reset, e um workflow de exemplo "e-mail vira chamado" (com `externalRef` = Message-ID e filtro de autorrespostas).

## 7. Dashboard

**Rota e escopo**
- `/dashboard`, com `dashboard:view`. O líder vê só as próprias equipes; o admin vê todas, com filtro.
- Pedido de dados de outra equipe por um líder responde 403.

**Filtros:** equipe e período (este mês, mês passado, últimos 30 dias, últimos 90 dias), nos limites do `APP_TIMEZONE`.

**Topo: cartões com efeito de contagem (React Bits), estáticos com reduced-motion**
- Abertos agora, com quantos estão sem responsável.
- Em risco e vencidos agora.
- % resolvidos no período com `resolvedAt ≤ resolutionDue`.
- Médias de `firstResponseBusinessMinutes` e `resolutionBusinessMinutes` no período, exibidas em horas úteis.

**Meio**
- "Vence primeiro": até 10 chamados em risco ou vencidos, com link.
- Carga por técnico: abertos, em risco e vencidos.

**Base: gráficos com o componente de chart do shadcn (Recharts)**
- Criados × resolvidos por semana no período.
- Volume por categoria.
- % no SLA por equipe.
- Tendência de 6 meses (volume e % no SLA).

**Dados e seed**
- `src/modules/dashboard/queries.ts` faz consultas agregadas parametrizadas, com cache em memória de 60 s por (equipes, período).
- O seed demo ganha cerca de 6 meses de histórico fictício, com resoluções dentro e fora do prazo.

## 8. Ordem de execução

Cada item é um plano próprio, aprovado antes de executar, com TDD, revisão independente ao final, correção dos achados importantes, merge no `master` e CI verde.

1. **Gestão:** seção 4 (admin, `AuditLog`, atribuir e assumir, reabrir e confirmar, fechamento automático, filtros, pendências).
2. **Integração n8n:** seção 6.
3. **SLA:** seção 5, mais os filtros "Vencendo" e "Vencidos", o badge e a tela de SLA no admin.
4. **Dashboard:** seção 7.

Os filtros "Vencendo" e "Vencidos" e o badge de SLA dependem do plano 3; o plano 1 entrega os demais filtros. No plano 1 o convite só exibe o link na tela para o admin repassar; a publicação de `auth.invite_created` e `auth.password_reset_requested` entra no plano 2.

## 9. Testes

- **Unitários:**
  - Calendário útil com datas fixas: sexta 17h30 + 60 min = segunda 8h30; início no sábado conta a partir de segunda 8h; feriado é pulado; pausa atravessando fim de semana.
  - Feriados móveis corretos para vários anos.
  - Assinatura HMAC.
  - `can()` com as ações novas.
- **Integração (Postgres real):**
  - Prazos e pausas nas transições; o job de SLA publica uma vez só.
  - Rollback não gera aviso; entrega com assinatura válida a um servidor HTTP local; retentativa após 500; nota interna nunca gera evento.
  - API: idempotência por `externalRef`, 401, 403, 413, 422 e 429.
  - Números do dashboard contra um conjunto fixo de chamados.
- **E2E (um fluxo por plano):**
  - Admin convida e o convidado entra.
  - Chamado criado pela API (n8n simulado) é assumido pelo técnico.
  - Chamado em Pendente pausa o prazo.
  - Líder abre o dashboard.

## 10. Riscos

- **Fuso e feriados errados distorcem o SLA.** Mitigação: funções puras com muitos casos de data fixa.
- **Segredo do webhook ou links de reset em logs do n8n.** Mitigação: payload mínimo, aviso na documentação e assinatura obrigatória.
- **n8n fora do ar.** Mitigação: fila com retentativa e reenvio manual pelo admin.
- **Spam pela API.** Mitigação: chave com escopo, limite por chave e solicitante obrigatoriamente cadastrado.

## 11. Fora da Fase 2

SSO; SLA por equipe ou categoria; SMTP e IMAP no sistema; anexos e leitura de chamados via API; múltiplos destinos de webhook; exportar CSV ou PDF; metas por equipe; qualquer funcionalidade de IA (Fase 3 em diante).
