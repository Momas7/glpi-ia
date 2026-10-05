# Fase 5: duplicados, incidentes em massa e resumo de conversa — Design

Data: 2026-10-03 · Status: aprovado em conversa; execução autorizada · Spec base: `docs/specs/2026-10-01-glpi-ia-design.md` (seção 5) · Fases anteriores: `…fase-3-triagem-ia-design.md`, `…fase-4-rag-design.md`

## 1. Objetivo

O sistema avisa quando um chamado novo parece repetir outro aberto, detecta quando muitos chamados parecidos chegam juntos (queda geral) e resume conversas longas. A IA continua só sugerindo: nada é mesclado, vinculado, fechado ou enviado sem uma pessoa.

**Sucesso:**
- Chamado novo recebe, em segundo plano, uma sugestão "possíveis duplicados" (mesma equipe, últimas 72 h).
- Cinco ou mais chamados parecidos em 30 minutos (de qualquer equipe) viram um **incidente**; líderes e admins veem uma faixa na tela e uma página de incidentes, e o n8n recebe o evento `incident.detected`.
- O técnico resume a conversa de um chamado com um clique; o resumo avisa quando a conversa avançou.
- Material do post 4 do LinkedIn (RAG + resumo + incidente em massa).

**Decisões já tomadas com o usuário:**
- Duplicado só **avisa** o técnico (ver ou "Não é duplicado"); sem vínculo e sem mesclagem.
- Incidente avisa pelo **n8n e por destaque na tela**.
- Resumo **sob demanda** (botão), com aviso de "há N comentários novos".
- Abordagem **A**: um vetor por chamado novo, reaproveitado por duplicados e incidente.

## 2. Abordagens escolhidas

| Decisão | Escolha | Alternativa descartada |
|---|---|---|
| Similaridade | Embedding do chamado novo (Fase 4) | `pg_trgm` só por palavras (fraco para descrições diferentes); modelo julgando pares (caro e lento) |
| Vetores de abertos | Tabela própria `OpenTicketVector`, removida ao resolver/fechar | Reaproveitar `TicketEmbedding` do RAG (mistura "resolvido com solução" com "aberto") |
| Escopo | Duplicados: mesma equipe, 72 h. Incidente: qualquer equipe, 30 min | Janela única para os dois |
| Resumo | Sob demanda, salvo em `AiSuggestion` | Automático por tamanho (gasta cota à toa) |

## 3. Modelo de dados (acréscimos)

- `AiSuggestionKind` ganha `DUPLICATE` e `SUMMARY`. Duplicado: `payload = { candidates: [{ ticketId, number, title, similarity }] }`, status `PENDING` ou `REJECTED` (ignorado). Resumo: `payload = { text, commentCount, lastCommentId }`, `confidence = 1`, substituído a cada geração (único por chamado e tipo).
- `OpenTicketVector`: `ticketId` (PK, cascade), `contentHash`, `embedding vector(768)`, `createdAt`; índice HNSW cosseno.
- `IncidentGroup`: `id`, `title`, `status` (`OPEN | CLOSED`), `detectedAt`, `closedAt?`, `closedById?`. `Ticket.incidentGroupId String?` (FK `SetNull`), índice.
- Migração no padrão das anteriores (HNSW à mão; remover do SQL gerado qualquer `DROP INDEX`/`ALTER` de objetos que o Prisma não conhece).

## 4. Detecção (`src/modules/ai/detect.ts`, job `ai.detect`)

Enfileirado na transação que cria o chamado (só com `AI_ENABLED=true`; arquivo-folha `enqueue.ts` como nas fases anteriores) e reenfileirado quando o chamado é resolvido ou fechado (o job remove o vetor).

`detectForTicket(ticketId)`:
1. Ignora chamado inexistente, encerrado, de equipe com `aiEnabled=false`, ou já com vetor de hash igual. Embeda `título + descrição` mascarados (`runEmbed`, `jobType: "detect"`, tipo `document`) e grava o vetor (hash inclui provider e modelo, como na Fase 4). `DISABLED`/`BUDGET` encerram sem erro; erro do provider propaga (pg-boss repete).
2. **Duplicados** (`findDuplicates`): chamados abertos (`NEW/OPEN/PENDING`) da **mesma equipe**, criados nas últimas `AI_DUPLICATE_WINDOW_HOURS` (72) horas, com vetor, `id ≠` o próprio, similaridade ≥ `AI_DUPLICATE_MIN_SIMILARITY` (0,85); até 3. Se houver, cria `AiSuggestion` `DUPLICATE` `PENDING` no chamado novo (idempotente).
3. **Incidente** (`detectIncident`): chamados abertos de **qualquer equipe**, com vetor, criados nos últimos `AI_INCIDENT_WINDOW_MINUTES` (30), com similaridade ≥ `AI_INCIDENT_MIN_SIMILARITY` (0,75) ao chamado novo, mais o próprio. Se o total ≥ `AI_INCIDENT_MIN_TICKETS` (5): se algum deles já pertence a um grupo `OPEN`, o chamado novo e os que estão sem grupo entram nele; senão cria um grupo `OPEN` (título = título do chamado mais antigo do conjunto, truncado) com todos. Criar um grupo emite `incident.detected` **na mesma transação** (uma vez por grupo).
- Todas as consultas SQL são parametrizadas; a similaridade é `1 - (a <=> b)`.
- Chamado resolvido/fechado sai do índice (vetor apagado) e deixa de contar.

**Ciclo de vida do grupo:** fecha sozinho quando todos os chamados dele estão `RESOLVED`/`CLOSED` (verificado no `ai.detect` de encerramento); ou à mão por `incident:close`. Chamado fechado continua ligado ao grupo (histórico).

**Evento ao n8n** (`EventType` ganha `"incident.detected"`): `{ id, title, ticketCount, teams: [nomes], url, detectedAt }`; nunca descrição nem texto de chamado. Documentado em `docs/integracao-n8n.md`.

## 5. Resumo (`src/modules/ai/summary.ts`)

`summarizeTicket(ator, ticketId)` (permissão `ai:decide`; mínimo 3 comentários, senão `TOO_SHORT`): lê os comentários do chamado (públicos e internos, em ordem, exceto rascunhos `AI_DRAFT`), monta o prompt (título, descrição e comentários como dados delimitados, com autor/papel), chama `runAi` (`jobType: "summary"`, modelo `AI_MODEL_SUMMARY`, padrão = modelo do rascunho), saída `{ summary: string 1..2000 }`, e grava/substitui `AiSuggestion` `SUMMARY` com `commentCount` e `lastCommentId`. Retornos: `SUMMARIZED | TOO_SHORT | DISABLED | BUDGET`. `getSummaryView` devolve o texto e `newComments` (comentários criados depois de `lastCommentId`). Sem aviso externo e sem SLA.

## 6. Telas e permissões

- `can()`: `incident:view` e `incident:close` (TEAM_LEAD e ADMIN; o líder só enxerga grupos com ao menos um chamado de uma equipe dele).
- Cartão **Possíveis duplicados** no chamado (`ai:decide`): até 3 candidatos (número, título, estado, % de similaridade, link só para os que o técnico pode abrir) e **Não é duplicado**; selo "Possível duplicado" na lista.
- **Faixa de incidente** no topo do layout para `incident:view` com incidente aberto; página **`/incidentes`** (grupos abertos e os 10 últimos encerrados, com chamados) e botão **Encerrar incidente**; item no menu. No chamado de um grupo, aviso à equipe "Parte do incidente …".
- Cartão **Resumo** no chamado (`ai:decide`): botão Resumir conversa, texto, "cobre N comentários", "há N comentários novos" e **Atualizar resumo**; nunca para o solicitante.
- Administração → IA: contagens de duplicados sugeridos/ignorados e de incidentes.

## 7. Configuração

`AI_DUPLICATE_MIN_SIMILARITY` (0,85), `AI_DUPLICATE_WINDOW_HOURS` (72), `AI_INCIDENT_MIN_SIMILARITY` (0,75), `AI_INCIDENT_WINDOW_MINUTES` (30), `AI_INCIDENT_MIN_TICKETS` (5), `AI_MODEL_SUMMARY` (opcional). Em `config.ts`, `.env.example` e `docker-compose.yml`.

## 8. Testes e avaliação

- Unitários: agrupamento (contagem, janela), schema do resumo, evento, componentes (duplicados, resumo, faixa, página).
- Integração (pgvector): duplicados (mesma equipe, 72 h, limiar, nunca o próprio/encerrado/equipe desligada), incidente (5 → um grupo e um evento; 6º entra; 4 não; assunto diferente não), fechamento do grupo, saída do vetor ao resolver, IA desligada/teto/falha sem derrubar o chamado, resumo (só equipe, mínimo, mascaração, atualizar, novos comentários), autorização.
- E2E: cinco chamados parecidos viram incidente (faixa e página para o líder); duplicado aparece e é ignorado; resumo de conversa longa.
- `npm run ai:eval:dup`: ~40 pares rotulados (duplicados, quase duplicados, diferentes); mede acerto e falsos alarmes para calibrar os limiares. Fora do CI.

## 9. Riscos e limites

- Limiar mal calibrado gera falso alarme ou deixa passar: padrões conservadores, calibração com a chave real, e o efeito de um erro é só um aviso.
- Pico de chamados de uma queda geral pode esgotar a cota de embeddings: o chamado é criado normalmente, sem vetor, e o "Reindexar tudo" refaz depois.
- Descrições vagas ("não funciona") geram vetores distantes e incidente subnotificado: o aviso é auxiliar.
- Dados sensíveis: o que vira vetor e o que vai ao resumo passa pela mascaração (nomes próprios continuam fora).

## 10. Fora desta fase

Mesclar ou vincular duplicados; resumo automático; painel de métricas de IA e CSAT no dashboard (Fase 6); aviso por e-mail do incidente (só n8n); busca híbrida.
