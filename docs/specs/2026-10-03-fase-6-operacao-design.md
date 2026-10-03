# Fase 6: métricas de IA, saúde do sistema e produção local com backup — Design

Data: 2026-10-03 · Status: aprovado em conversa; execução autorizada · Spec base: `docs/specs/2026-10-01-glpi-ia-design.md` (seções 7 a 9) · Fases anteriores: 3 a 5 (IA)

## 1. Objetivo

Fechar o projeto como algo que se opera de verdade: mostrar com números o que a IA faz e o que os clientes acham do atendimento, enxergar a saúde do sistema, e rodar em "produção" na máquina do dono com HTTPS local e backup que se prova restaurável.

**Sucesso:**
- O Dashboard mostra satisfação (CSAT), uso da IA no atendimento e, para o admin, uso e custo de IA, com dados de demonstração marcados.
- `GET /api/health/ready` e a página **Saúde do sistema** mostram banco, vetor, migrações, fila, worker, backup e avisos ao n8n.
- `docker-compose.prod.yml` sobe Caddy (HTTPS local), web, worker e Postgres numa máquina só; os segredos são gerados por script.
- Backup diário e **teste de restauração** automáticos, com estado visível na página de saúde.
- Material do post 5 do LinkedIn: o painel de métricas com números e as lições aprendidas.

**Decisões já tomadas com o usuário:** roda só na máquina dele (projeto pessoal, sem domínio nem servidor); painel dentro do Dashboard existente; seed com histórico fictício de IA marcado como demonstração, somado ao uso real; observabilidade enxuta (nada de Prometheus/Grafana).

## 2. Dados (acréscimos)

- `AiAuditLog.demo`, `AiSuggestion.demo` e `TicketRating.demo` (`Boolean @default(false)`): linhas geradas pelo seed. O painel avisa quando o período contém demonstração.
- `WorkerHeartbeat { service String @id, beatAt DateTime }`: o worker grava a cada 60 s.
- Evento `AI_DRAFT_PUBLISHED` em `TicketEvent` (rascunho que virou comentário público). O `DELETE …/ai/draft` aceita `?published=1`; o cartão do rascunho usa isso ao publicar.
- Migração no padrão das anteriores.

## 3. Métricas (módulo `dashboard`)

`getDashboard` passa a devolver também `csat`, `aiAssist`, `aiUsage?` (só admin) e `hasDemoData`, no mesmo cache de 60 s por (equipes, período, papel). Consultas agregadas parametrizadas, filtros nus de data (como as demais).

- **CSAT** (`TicketRating` ⋈ `Ticket`, escopo por equipe do chamado, período por `TicketRating.createdAt`): média, quantidade, distribuição 1 a 5 e tendência dos últimos 6 meses.
- **IA no atendimento** (escopo por equipe do chamado, período por criação): triagem (sugeridas, aceitas, editadas, rejeitadas, pendentes e taxa de aceite), rascunhos (gerados = eventos `AI_DRAFT`, publicados = `AI_DRAFT_PUBLISHED`), duplicados (sugeridos e ignorados), resumos (`AI_SUMMARY`) e incidentes detectados (grupos com chamado do escopo).
- **Uso e custo de IA** (global, só `ADMIN`; `AiAuditLog`): por tipo de tarefa (`triage`, `embed`, `detect`, `search`, `draft`, `summary`): chamadas, sucessos, falhas, barradas por teto, tokens de entrada e saída, custo estimado; custo por dia; latência mediana e p95 (só chamadas OK).
- `hasDemoData`: existe linha `demo = true` no período em `AiAuditLog`, `AiSuggestion` ou `TicketRating`.
- Rodapé do painel: custo é estimativa; acerto = aceite pela equipe, não verdade absoluta.

## 4. Telas do painel

Nova seção no `/dashboard`, abaixo da atual: **Satisfação** (cartões média e avaliações; gráficos de distribuição e de tendência), **IA no atendimento** (cartões e tabela) e, só para o admin, **Uso e custo de IA** (cartões de custo e chamadas, gráfico de custo por dia, tabela por tarefa com latência). Estados vazios claros, texto alternativo nos gráficos, animação respeitando `prefers-reduced-motion`. Aviso "dados de demonstração incluídos" quando `hasDemoData`.

## 5. Seed de demonstração

`seedAiDemo(db)` no `prisma/seed.ts` (idempotente, determinístico, só roda se não houver linha `demo`): para os chamados "Histórico N" gera sugestões de triagem com status variados (aceite ~70%, edição ~15%, rejeição ~15%), avaliações para ~55% dos fechados (média ~4,2), duplicados e resumos esparsos, 2 incidentes encerrados, e `AiAuditLog` espalhado por 6 meses com custos e latências plausíveis (custo estimado por tabela de preços). Tudo `demo = true`. Nada de texto real de empresa.

## 6. Saúde do sistema

- `GET /api/health` continua leve (banco). **`GET /api/health/ready`**: banco, extensão `vector`, migrações (nenhuma falha pendente em `_prisma_migrations`), fila do pg-boss acessível e worker vivo (batimento ≤ 180 s); 503 se algo essencial falhar; corpo `{ status, checks: [{ name, ok, detail }] }` sem segredo nem texto de chamado.
- **Batimento:** o worker grava `WorkerHeartbeat` ao subir e a cada 60 s.
- Página **Administração → Saúde do sistema** (`admin:manage`): as mesmas verificações; filas (pendentes, em andamento, falhas e idade do mais antigo, por fila); avisos ao n8n nas últimas 24 h (entregues, pendentes, falhos); backup (data, tamanho e resultado do último backup e do último teste de restauração, lidos de `BACKUP_STATE_FILE`; alerta se o backup tem mais de 26 h); banco (tamanho e contagens).
- **Logs:** toda rota ganha `X-Request-Id` (aceita o do cliente se for seguro, senão gera) e uma linha de log com método, rota, status e tempo; 5xx registram rota e id, nunca o corpo da requisição. Nível por `LOG_LEVEL`.

## 7. Produção local

- **`docker-compose.prod.yml`** (`podman-compose` e `docker compose`): `caddy` (HTTPS local com `tls internal`; portas `127.0.0.1:${HTTPS_PORT:-8443}` e `${HTTP_PORT:-8080}`), `web`, `worker`, `postgres` (pgvector) em rede interna; `restart: unless-stopped`, healthchecks, limites de memória, logs rotacionados; volumes nomeados para banco e anexos; o diretório de backup do host montado somente leitura no `web` (para a página de saúde).
- **Imagem `web` enxuta:** só o necessário para o `prisma migrate deploy` (CLI do Prisma e dependências), não o `node_modules` inteiro.
- **`scripts/prod-init.sh`:** cria `.env.prod` (permissão 600) com `SESSION_SECRET`, `POSTGRES_PASSWORD` e segredo do n8n gerados; cria o primeiro admin (`admin:create`); nada fixo no repositório. `.env.prod.example` documenta as variáveis.
- **Backup (`scripts/backup.sh`):** `pg_dump` comprimido (com os vetores) e `tar` dos anexos em `BACKUP_DIR` (padrão `~/backups/chamados`), carimbo de data, retenção de 14 diários e 8 semanais, grava `estado-backup.json`. **Restauração (`scripts/restore.sh`)** pede confirmação antes de sobrescrever. **Teste (`scripts/restore-test.sh`)** sobe um Postgres descartável, restaura o último backup, confere contagens (usuários, chamados, vetores, anexos) contra o banco vivo e grava o resultado no estado. Unidades de timer do systemd do usuário de exemplo (backup diário às 2h; teste semanal).
- **`docs/operacao.md`:** subir, parar, atualizar, voltar versão, ligar a chave do Gemini, backup, restauração, solução de problemas e a recomendação de guardar uma cópia fora da máquina.

## 8. Testes e verificação

- Unitários: componentes do painel, formatação, leitura do estado de backup, verificações de texto do compose/Dockerfile/Caddyfile/scripts.
- Integração: consultas de métricas (valores calculados à mão, escopo por equipe, só admin vê uso e custo, demonstração marcada), seed idempotente, `ready` (cada falha derruba o status), batimento, filas, backup/restauração/teste de restauração ponta a ponta contra um Postgres descartável, request id.
- E2E: painel com seções de satisfação e IA para o líder, uso e custo para o admin, página de saúde.
- **Fumaça real do pacote de produção** (uma vez, na verificação final): build das imagens, `up`, `https://localhost:8443/api/health/ready` verde, backup e teste de restauração reais.

## 9. Riscos e limites

- Os números de demonstração não são uso real: sempre marcados, e o README diz isso.
- O custo é estimativa por tabela de preços; o acerto é aceite humano.
- Backup na mesma máquina não protege de perder a máquina: o doc recomenda cópia externa.
- Certificado do Caddy é interno: o navegador pede para confiar na primeira vez.
- Portas altas (8443/8080) porque Podman sem root não abre portas abaixo de 1024.

## 10. Fora desta fase

Domínio público e certificado real, alta disponibilidade, Prometheus/Grafana, tracing, alertas por e-mail, cópia automática de backup para a nuvem, importador do GLPI.
