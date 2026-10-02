# Sistema de chamados com IA (estilo GLPI) — Design

Data: 2026-10-01 · Status: aguardando revisão

## 1. Objetivo e contexto

Sistema de chamados no estilo GLPI com automações de IA, com dois usos:

1. **Uso real** na empresa do autor, ao lado ou no lugar do GLPI atual.
2. **Portfólio público** no LinkedIn: repositório público limpo, README com GIF e diagrama, seed fictício e uma série de 5 posts, um por marco.

**Sucesso:** a empresa usa de verdade; o repositório público demonstra o sistema com dados fictícios.

### Restrições e respostas já definidas
- A empresa **permite publicar o código**: um único repositório público atende aos dois usos. Configurações da empresa vivem só em variáveis de ambiente e no servidor, nunca no Git.
- **Volume:** grande (mais de 300 usuários ou mais de 1.500 chamados/mês). Exige índices e paginação desde a Fase 1, fila de IA com limite de taxa e teto de gasto, backup e monitoramento.
- **Login:** e-mail e senha, com cadastro por convite. SSO fica fora do escopo.
- **Visual:** React Bits como camada de identidade visual (ver seção 8).

### Fora de escopo (YAGNI)
SSO, app mobile, multi-tenant, portal de autoatendimento com chat de IA, ativos/inventário do GLPI e IA agindo sozinha.

## 2. Stack

Next.js (App Router + Route Handlers), TypeScript, PostgreSQL com pgvector, Prisma, pg-boss (sem Redis), Tailwind + shadcn/ui, componentes React Bits, Zod, Vitest, Testcontainers, Playwright, pino, Docker Compose, Caddy.

## 3. Arquitetura (monólito modular com worker separado)

Um único pacote Next.js, sem monorepo. Dois processos com o mesmo código: `web` (UI e Route Handlers) e `worker` (pg-boss). No Compose: `web`, `worker`, `postgres`, mais o proxy em produção.

```
src/
  app/                  # UI (App Router) + Route Handlers (/api/*)
  modules/
    tickets/            # CRUD, status, comentários, anexos
    sla/                # políticas, prazos, escalonamento
    teams/ users/ auth/ # papéis, convites, sessão, can()
    notifications/      # e-mail (SMTP/IMAP)
    kb/                 # base de conhecimento
    ai/
      provider/         # LLMProvider, EmbeddingProvider, implementações
      masking/          # mascaramento de dados sensíveis
      triage/ suggest/ summarize/ dedupe/
      audit/            # log de toda chamada de IA
  worker/index.ts       # entrypoint do pg-boss
  lib/                  # db (Prisma), config/env, logger, queue
prisma/                 # schema, migrations, seed fictício
```

**Fronteiras:** cada módulo expõe um `index.ts` público; outros módulos não importam arquivos internos. Módulos de IA só falam com o LLM via `LLMProvider`. A mascaração ocorre dentro do wrapper de IA, antes de qualquer provider.

**Fluxo principal (chamado novo):** o Route Handler grava o chamado e enfileira o job `triage` na **mesma transação**; o worker mascara, chama o LLM e grava uma sugestão; o técnico aceita ou ajusta; tudo é auditado. A IA só propõe, a pessoa decide.

## 4. Modelo de dados (Prisma + pgvector)

**Identidade:** `User` (nome, e-mail único, `passwordHash` argon2, `role` = REQUESTER | AGENT | TEAM_LEAD | ADMIN, `active`, `failedLogins`, `lockedUntil`), `Session`, `Invite`, `PasswordReset` (tokens só como hash, uso único, expiração), `Team`, `TeamMember`, `Category` (árvore, equipe padrão opcional).

**Chamados:** `Ticket` (número sequencial legível, título, descrição, `status` NEW | OPEN | PENDING | RESOLVED | CLOSED, `priority`, `type` INCIDENT | REQUEST, solicitante, responsável, equipe, categoria, `slaPolicyId`, `firstResponseDue`, `resolutionDue`, `resolvedAt`, `closedAt`, `embedding vector(768)`, `incidentGroupId`), `Comment` (`internal`, `source` WEB | EMAIL | AI_DRAFT), `Attachment`, `TicketEvent` (histórico), `SlaPolicy` (tempos por prioridade e calendário comercial).

**Conhecimento (RAG):** `KbArticle`, `KbChunk` (texto, `embedding vector(768)`, índice HNSW). Chamados resolvidos viram fonte do RAG pelo embedding do próprio `Ticket` (título, descrição e solução final).

**IA:** `AiSuggestion` (`kind` TRIAGE | REPLY | SUMMARY | DUPLICATE, payload JSON, confiança, `status` PENDING | ACCEPTED | EDITED | REJECTED, `decidedBy`, `decidedAt`), `AiAuditLog` (provider, modelo, tipo de job, tokens, custo estimado, latência, `inputHash`, resultado, erro; texto mascarado com retenção configurável, padrão 30 dias, **nunca o prompt em claro**), `IncidentGroup`.

**Decisões:** coluna `Unsupported("vector(768)")` com consultas de similaridade via `$queryRaw` parametrizado, encapsuladas em um único repositório em `modules/ai`. Índices desde a Fase 1: `(status, teamId, assigneeId)`, `createdAt` e `pg_trgm` no título. O pg-boss usa seu próprio schema (`pgboss`) no mesmo banco, fora do Prisma.

## 5. Pipeline de IA

**Interfaces separadas:**
- `LLMProvider.generate({ system, messages, schema, model })` devolve JSON validado por Zod. Implementações `gemini.ts` (desenvolvimento) e `anthropic.ts` (produção), escolhidas por `LLM_PROVIDER`.
- `EmbeddingProvider.embed(texts[])` devolve vetores de 768 dimensões. **Decisão: Gemini embeddings em dev e produção**, para evitar reindexação. O texto vai mascarado.
- Wrapper comum: retry com backoff, timeout, limite de taxa e teto diário de gasto (`AI_DAILY_BUDGET`). Estourado o teto, o job espera e o sistema segue sem IA.
- Mapeamento tarefa→modelo em config: triagem e duplicados no modelo pequeno (Haiku); sugestão de resposta e resumo no maior.

**Mascaração (`ai/masking`):** substitui CPF, e-mail, telefone, IP, cartão, senhas e tokens (heurística) por tokens reversíveis (`[CPF_1]`); o mapa existe só em memória durante o job; a resposta é desmascarada antes de gravar. Testes adversariais no CI. **Risco conhecido:** regex não cobre tudo (nomes próprios); o mascarador é configurável.

**Automações (jobs do pg-boss):**
- `triage`: categoria, prioridade, equipe e confiança; abaixo do limiar, não sugere.
- `suggest`: busca vetorial em `KbChunk` e chamados resolvidos, rascunho com citações das fontes, gravado como `Comment` com `source=AI_DRAFT`, nunca enviado sem um humano.
- `summarize`: resume threads longas, por tamanho ou pedido manual.
- `dedupe`: similaridade entre chamados abertos; muitos parecidos em poucos minutos criam `IncidentGroup` e alertam o gestor.

**Invariantes:** a IA só escreve em `AiSuggestion` e rascunhos; nenhum caminho da IA altera status para RESOLVED/CLOSED; todo job grava `AiAuditLog`; a saída do LLM é não confiável (validada por schema, renderizada como texto); o conteúdo do chamado é dado, não instrução (defesa contra prompt injection).

## 6. Segurança, privacidade e e-mail

**Autenticação:** argon2id; senha com no mínimo 12 caracteres e checagem contra senhas comuns; bloqueio após 5 falhas; rate limit por IP e por conta; sessão no banco com cookie `HttpOnly`, `Secure`, `SameSite=Lax`, rotação no login e revogação ao trocar a senha; cadastro só por convite; reset por token de uso único com resposta idêntica exista ou não o e-mail; proteção CSRF por Origin e token.

**Autorização:** função central `can(user, action, resource)` usada por todo Route Handler. Solicitante vê só os próprios chamados e comentários não internos; técnico vê as equipes dele; gestor vê a equipe e as métricas; admin vê tudo. Matriz papel × ação coberta por testes.

**Entrada e saída:** Zod em toda entrada; Prisma parametrizado e `$queryRaw` só com parâmetros; texto sempre escapado, com Markdown restrito; anexos com limite de tamanho, tipos permitidos, nome gerado no servidor e fora do diretório público (antivírus opcional na Fase 6).

**Privacidade e IA:** mascaração obrigatória; interruptores `AI_ENABLED` global e por equipe; segredos só em variáveis de ambiente; gitleaks, `npm audit` e Dependabot no CI.

**E-mail (Fase 2):** SMTP de saída pelo worker, com retry, para criação, atribuição, resposta e SLA a vencer. Entrada por IMAP polling num job do pg-boss; `Message-ID`, `In-Reply-To` e o número no assunto ligam a resposta ao chamado; entra como `Comment` com `source=EMAIL`, com o mesmo escape. Autorrespostas (`Auto-Submitted`, `Precedence: bulk`) são ignoradas.

## 7. Testes, CI, observabilidade e deploy

**Testes:** Vitest para mascaração, SLA (horário comercial, feriados, pausa em PENDING), `can()` e schemas do LLM; integração com Postgres real via Testcontainers (handlers, transação chamado+job, similaridade, worker); `FakeLLMProvider` determinístico no CI; conjunto de **avaliação** manual contra Gemini e Claude que mede acerto de triagem; Playwright para login, criar chamado, ver e aceitar sugestão (também gera o GIF do README). CI no GitHub Actions: lint, tipos, testes, build, gitleaks e `npm audit`.

**Observabilidade:** logs estruturados (pino) com id de correlação entre web e worker; `/api/health` para web, banco e fila. **Painel de IA (Fase 6):** taxa de aceite por tipo, tempo economizado estimado, custo por chamado, latência, erros e volume por modelo.

**Deploy (Fase 6):** Docker Compose em produção (`web`, `worker`, `postgres` com pgvector, Caddy com HTTPS automático); migrations do Prisma na subida; backup diário com `pg_dump` e teste periódico de restauração; anexos em volume com backup. Variáveis: `LLM_PROVIDER`, `EMBEDDING_PROVIDER`, `AI_DAILY_BUDGET`, `AI_ENABLED`, SMTP/IMAP e segredos de sessão. A hospedagem da empresa será definida com a infraestrutura dela; a demo pública usa um VPS pequeno com seed e Gemini limitado.

## 8. Camada visual

Tailwind + shadcn/ui formam a base funcional; React Bits (instalado como código-fonte via `npx shadcn@latest add @react-bits/<Nome>-TS-TW`) entra como identidade visual.
- **Usar em:** login e convite (fundo animado e título com efeito), cartões de métricas do dashboard, estados de processamento da IA (`ShinyText`), navegação (Dock ou sidebar).
- **Não usar em:** lista e detalhe de chamado (telas de trabalho diário), nem fundos WebGL em telas densas.
- **Regras:** tema escuro por padrão com opção de claro; respeito a `prefers-reduced-motion`; fundos animados carregados sob demanda; licença conferida na Fase 0 e registrada em `THIRD_PARTY.md`.

## 9. Fases

| Fase | Entrega |
|---|---|
| 0 | Setup: Docker Compose, Prisma, Tailwind/shadcn/tema, CI, `.env.example`, seed fictício, licença |
| 1 | Auth (convite, login, reset, papéis, `can()`) e CRUD de chamados, com índices e paginação |
| 2 | SLA, equipes, e-mail (SMTP e IMAP) e dashboard |
| 3 | `LLMProvider`, mascaração, wrapper de IA, auditoria e triagem |
| 4 | `EmbeddingProvider`, RAG sobre KB e chamados resolvidos, sugestão de resposta |
| 5 | Resumo, duplicados e incidentes em massa |
| 6 | Painel de métricas de IA, observabilidade, backup e deploy |
| Opcional | Importador do GLPI via API REST (script único e idempotente, alimenta o RAG com histórico) |

## 10. Repositório público e LinkedIn

Repositório com seed 100% fictício e nenhum dado ou nome real da empresa em qualquer commit; `README` com GIF e diagrama; `LICENSE` (MIT sugerida); `SECURITY.md`; `THIRD_PARTY.md`; uma tag de release por marco.

**Série de 5 posts:** (1) Fases 0–1: por que e a arquitetura; (2) Fase 2: SLA, e-mail e dashboard; (3) Fase 3: triagem e abstração Gemini↔Claude; (4) Fases 4–5: RAG com citações, resumo e incidente em massa; (5) Fase 6: métricas reais de IA e lições aprendidas.

## 11. Riscos conhecidos

- Mascaração por regex não pega nomes próprios.
- Custo e limites de API em volume grande: mitigados por teto diário, modelo pequeno na triagem e fila.
- Qualidade do RAG depende da base de conhecimento e do histórico; o importador do GLPI ajuda.
- O mesmo modelo de embedding é obrigatório em dev e produção; trocá-lo exige reindexar tudo.
- Animações do React Bits em máquinas fracas: restritas às telas leves.
