# Pendências e decisões das Fases 0 e 1

Registro do que ficou adiado nas revisões independentes e das decisões que mudam o plano. Entrada para o plano da Fase 2.

## Lacunas conhecidas (candidatas à Fase 2)

- **Tela de convite para o admin** (a API `POST /api/auth/invite` existe) e gestão de usuários e equipes.
- **Controle de equipe/responsável no detalhe do chamado** para líder e admin (hoje só via API). Atribuição por "assumir" para técnico não existe.
- **SMTP real.** O transporte padrão de e-mail apenas registra no log, inclusive o link de reset de senha. Só serve para desenvolvimento.
- **Reabrir/confirmar fechamento pelo solicitante** e filtros "meus"/"minha equipe" na lista.
- Rate limit é por processo (em memória). Com mais de uma instância do `web`, cada uma conta por si.
- Cookie de sessão é `Secure`: acesso por `http://servidor:3000` não mantém o login até haver HTTPS (Caddy, Fase 6).
- Job `e2e` e `gitleaks-action` do CI não foram validados no GitHub (o repositório ainda não tem remoto).
- `LICENSE`: o titular está como "Autores do projeto Chamados IA"; trocar pelo nome real.

- Build do Next avisa "Dynamic filesystem access causes tracing of the whole project" em `src/modules/tickets/attachments.ts` (`readFile(path.join(uploadDir(), ...))`): a saída standalone passa a incluir o projeto inteiro. Escopar o caminho ou marcar o acesso para o Turbopack ignorar.

## Minor adiados (Fase 0)

- Health check: timer de timeout não é limpo; teste não cobre timeout e deixa env/`globalThis.db` sujos.
- Worker: segundo SIGTERM e rejeição de `stopQueue` sem log estruturado; `stopQueue` durante o `start` perde a instância.
- `CMD` do web sem `exec` (o SIGTERM não chega ao node; o worker via `npm run` idem).
- Teste de reduced-motion fraco (verificar contêiner vazio e `renderToString`).
- Opção `esbuild` do Vitest é ignorada (o Vitest usa oxc).
- Teste de rollback da fila depende de espera fixa de 3 s; "chamado uma vez" não reconfere após intervalo.
- Seed sobrescreve `defaultTeamId` escolhido pelo admin.
- CI sem `permissions: contents: read`, actions fixadas por tag e execuções duplicadas em PR.
- `AI_DAILY_BUDGET` e `SMTP_PORT` vazios viram 0.

## Minor adiados (Fase 1)

- `PATCH` com campos e status juntos não é atômico.
- FK inexistente vira 500; atribuição a usuário inativo ou solicitante é aceita.
- Tokens antigos de reset/convite continuam válidos; reset não usa transação.
- Latência do `forgot` revela se o e-mail existe (relevante com SMTP síncrono: enviar via pg-boss).
- Cookie malformado gera 500; logout sem checagem de Origin.
- Anexos: `.jpeg` recusado, txt/log em Windows-1252 recusado, sem limite de volume por chamado/usuário, `filename*` não escapa `'()*`.
- Seed demo não valida a política de senha nem recusa `NODE_ENV=production`.
- Testes: asserções `toThrow()` genéricas; faltam teste do limite por e-mail no login, corrida no aceite de convite e atribuição pelo líder via HTTP; `seed.test.ts` depende da ordem dos `describe`.

## Minor adiados (Fase 2.1, gestão)

- `assignTicket` não trava o chamado: duas atribuições simultâneas (líder × líder, ou líder × "Assumir") sobrescrevem sem aviso.
- Corrida entre revogar e aceitar convite pode marcar como revogado um convite que já virou usuário.
- Select de papel e botão "Desativar" agem sem confirmação e não voltam ao valor anterior quando a API recusa.
- Convidar um e-mail que já tem conta gera link que sempre falha, sem aviso; falta "reenviar" na lista de pendentes.
- "Assumir" e "Salvar atribuição" aparecem em chamados resolvidos ou fechados.
- Admin rebaixado durante uma requisição ainda a conclui (janela pequena entre checagem e transação).
- `autoCloseResolved` relê `AUTO_CLOSE_DAYS` do ambiente; valor vazio vira 0 se chamado fora do worker.
- Faltam testes do agendamento do worker e das rotas de reabrir/confirmar para outro solicitante.
- Atribuição sem mudança ainda grava evento ASSIGNED.

## Minor adiados (Fase 2.2, integração com o n8n)

- Dois cliques em "Reenviar" ao mesmo tempo enfileiram o aviso duas vezes (o n8n deve descartar repetições por `X-Event-Id`).
- A entrega segue redirects: com 301/302 o POST vira GET; com 307/308 a assinatura vai para outro host. Usar `redirect: "manual"`.
- O corpo com token de convite/reset fica no pg-boss durante as retentativas (~1–2 h) e mais 1 h depois; um link de reset pode chegar já vencido.
- Entregas presas em PENDING (worker parado) não aparecem na tela de falhas.
- Entrega com concorrência 1: um n8n lento acumula atraso.
- Requisições sem chave válida não têm limite antes da autenticação; `lastUsedAt` é gravado mesmo quando a resposta é 429.
- "Revogar" chave de API não pede confirmação.
- Trocar a chave do n8n quebra a idempotência por `externalRef` (reprocessar e-mails antigos duplica chamados).
- Formato dos cabeçalhos do nó IMAP e do erro do HTTP Request no workflow de exemplo não foram verificados num n8n real.

## Minor adiados (Fase 2.3, SLA)

- A varredura de SLA não reconfere status, pausa e prazo ao marcar: um chamado resolvido no meio da varredura pode receber alerta.
- Mudar expediente ou feriados não recalcula prazos já gravados (só a política é congelada pelo spec; o restante deveria acompanhar).
- O cache do calendário é invalidado só no processo que recebeu a mudança; o worker usa o antigo por até 5 min.
- `businessMinutesBetween` anda dia a dia: chamados vencidos há muito tempo custam CPU na lista.
- O texto "1 dia útil" do badge assume 10 h de expediente.
- Feriado com data inexistente (ex.: 2026-02-30) enviado pela API vira outra data.
- Testes: pausa só com `pausedAt` preenchido à mão; teste de horário de verão fora do expediente; total fixo de feriados no teste do seed; E2E "Vencidos" depende da hora.

## Dependências de desenvolvimento com aviso de segurança

- `braces` (GHSA-vfj7-8cjw-p6xm, negação de serviço por padrões aninhados, severidade alta) não tem versão corrigida (a última, 3.0.3, é a afetada). Entra só por ferramentas de desenvolvimento (CLI do `shadcn` e `eslint-config-next`, via `fast-glob`/`micromatch`). O `shadcn` foi movido para `devDependencies` e o job `audit` do CI audita só as dependências de produção (`--omit=dev`). Rever quando houver versão corrigida do `braces` ou das ferramentas que o usam.

## Decisões de produto/segurança não resolvidas

- Bloqueio de conta por 5 falhas permite que terceiros bloqueiem um colega repetidamente (negação de serviço). Mitigar (bloqueio por IP+conta, atraso progressivo) é decisão de produto.
- CSRF só por `Origin` (ausente é aceito), sem token; o spec cita "Origin e token". Com `SameSite=Lax` não há caminho explorável conhecido.
- Não verificado se o Next 16 impõe limite de corpo em Route Handlers num servidor real (o limite próprio em `src/lib/body.ts` cobre isso).

## Decisões que alteram o plano original

- Prisma fixado em 7.10.0 (a tag `latest` do pacote `prisma` aponta para um release candidate 8).
- Testcontainers e Compose rodam em Podman nesta máquina (`DOCKER_HOST` para o socket do usuário).
- `Ticket.number` usa `autoincrement()` (pode haver lacunas).
- Busca por título via `contains` insensível com curingas escapados (o Prisma não escapa `%` e `_`).
- `X-Forwarded-For` é lido da direita (`TRUSTED_PROXY_HOPS`, padrão 1); `web` publicado só em `127.0.0.1`.
- Chamado sem equipe vai para `DEFAULT_INTAKE_TEAM` (padrão "Suporte N1").
- Imagem `web` copia o `node_modules` completo para rodar migrations; otimizar na Fase 6.
- Licença do React Bits é MIT + Commons Clause: `src/components/bits/` fica fora da MIT do projeto.
