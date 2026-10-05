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

## Minor adiados (Fase 2.4, dashboard)

- "Vence primeiro" ordena por prazo com limite de 10: uma equipe com muitos vencidos antigos não vê os que ainda dá para salvar (decisão de produto: reservar vagas para os em risco).
- Equipe sem resolvidos aparece como 0% no tooltip do gráfico de SLA (deveria dizer "sem dados").
- O Recharts cria um SVG focável dentro do `role="img"` (`accessibilityLayer`).
- A primeira semana do período aparece com o rótulo da segunda-feira anterior (semana parcial).
- "Carga por técnico" omite quem está sem chamados abertos.
- `resolveScope` checa a existência da equipe antes da autorização (um líder distingue 400 de 403).
- A página do dashboard responde HTTP 200 ao negar acesso a uma equipe (o spec fala em 403).
- Seed do histórico: resolvidos sem `pausedAt`, e o fechamento automático fecha cerca de 54 deles na primeira execução do worker.
- Menu lateral: `aria-controls` aponta para um id que não existe com o menu fechado; o Esc não devolve o foco ao botão.
- Cache do dashboard sem despejo de entradas vencidas e sem proteção contra rajada simultânea.

## Fase 3 (triagem por IA): menores adiados

- "Editar" na sugestão permite mandar o chamado a qualquer equipe sem `ticket:assign` (aceitar a sugestão é intencional; o edit livre amplia o poder do técnico).
- Tentativas multiplicadas: `runAi` tenta 3 vezes e a fila 3 vezes (até 12 chamadas); erros não retentáveis também voltam pela fila; chamada que falhou grava custo 0 mesmo tendo gasto tokens.
- O texto é cortado antes da máscara: o corte no meio de um e-mail ou CPF deixa o pedaço em claro.
- Máscara: telefone "11 9 8765-4321" não é pego; número de 10 dígitos vira TEL e versão "10.2.3.4" vira IP; o regex de e-mail é quadrático (ReDoS se usado sem limite de tamanho, ex.: Fase 4).
- Teto diário não é atômico (workers em paralelo podem estourá-lo em até N chamadas).
- IA ligada com `LLM_PROVIDER=fake` (o padrão) mostra sugestões por palavra-chave como "da IA"; avisar no painel ou recusar em produção.
- Rota única `POST /api/tickets/[id]/ai/triage` com `action` no corpo, no lugar das três rotas do spec.
- Qualidade real da triagem não medida (sem chave de API): rodar `npm run ai:eval` com Gemini e Claude.

## Fase 4 (RAG): menores adiados

- Busca só vetorial: códigos de erro e nomes de servidor às vezes escapam; a busca híbrida (vetor + palavras) é a evolução prevista.
- A busca pega os 50 vizinhos mais próximos por fonte e filtra depois; em base muito grande com muitos chamados de outras equipes, vale revisar o `hnsw.iterative_scan` (já ligado quando o pgvector suporta).
- O rascunho cita fontes, mas não verifica se cada frase é sustentada pelo trecho citado (só valida que as citações existem).
- O rascunho usa só título e descrição do chamado como pergunta; comentários da conversa não entram.
- A avaliação não pode ser editada nem apagada; sem fluxo para corrigir uma nota dada por engano.
- O dashboard ainda não mostra a média das avaliações (Fase 6).
- A solução obrigatória vale na tela e na API; chamados criados por integração ou importação direta no banco podem ficar sem solução e dependem do último comentário público da equipe.
- Artigos sem versionamento: editar sobrescreve, sem histórico além do `AuditLog`.
- "Reindexar tudo" ignora a cota restante do provedor: em plano gratuito pode parar no meio (basta repetir).

## Fase 4 (RAG): revisão final, menores adiados e decisão de produto

- **Decisão sua:** as fontes de chamados seguem o acesso do técnico (equipe dele, responsável ou solicitante), como no spec. Admin, ou técnico que é responsável/solicitante de um chamado de outra equipe, pode ver essas fontes no rascunho de um chamado da equipe A, e a nota interna do rascunho é lida pela equipe toda. Se quiser isolamento estrito, é só filtrar as fontes de chamado pela equipe do chamado de destino.
- Artigo editado com a IA em `BUDGET` ou desligada deixa o texto antigo na busca até a próxima reindexação (o job termina como "sem mudança").
- Corrida entre `ai.index_article` e `ai.reindex_all` no mesmo artigo pode duplicar trechos (falta `UNIQUE(articleId, position)` e trava consultiva).
- Teto de gasto estourado no embedding da pergunta aparece como "sem fontes" no cartão do rascunho.
- Dois pedidos de rascunho simultâneos podem deixar dois `AI_DRAFT` (a tela mostra o mais recente).
- O cartão do rascunho diz "só você vê" mas a equipe toda vê a nota interna.
- Modelo de rascunho do Gemini fixo em `gemini-3.8-flash` (o spec diz "o modelo da triagem") e fora da tabela de preços (cobrado pelo preço mais alto).
- Com o provider `fake` o teto diário é consumido pelo preço do modelo de embedding configurado.
- Validação de citações olha só o array `citations`, não as marcas `[n]` do texto; o bloco FONTES não tem delimitador próprio.
- A avaliação dada em Resolvido sobrevive à reabertura (e uma nota baixa antiga tira o chamado da base para sempre); o status é checado fora da transação.
- Estrelas: a seta muda a nota mas o foco não acompanha o rádio (padrão ARIA de radiogroup).
- `reindexAll` aborta no primeiro erro não temporário e as novas tentativas voltam a parar no mesmo item.

## Fase 5 (duplicados, incidentes e resumo): menores adiados

- Os limiares padrão (0,85 e 0,75) são estimativas: só valem depois de rodar `npm run ai:eval:dup` com a chave real.
- Duplicados só consideram a mesma equipe; um chamado que muda de equipe depois da triagem não é recomparado.
- O incidente é decidido na chegada de cada chamado; se a cota de embeddings acabar no pico, o grupo só aparece quando algum chamado for reprocessado (hoje, só ao mudar o status do chamado).
- A trava consultiva da detecção de incidente é global (uma por vez); em volume muito alto de chamados simultâneos pode virar gargalo.
- O título do incidente é o do chamado mais antigo do conjunto; não há edição.
- Chamado fechado continua ligado ao incidente (histórico), mas o aviso no chamado só aparece enquanto o incidente está aberto.
- O resumo usa só o texto dos comentários; anexos e eventos do chamado não entram.
- Sem limite de pedidos de resumo por usuário além do teto diário de gasto.
- Reabrir um chamado que fazia parte de um incidente fechado não reabre o incidente.

## Fase 5: revisão final e decisão de produto

- **Decisão sua:** o título do incidente é o do chamado mais antigo do conjunto (mascarado) e aparece para todo gestor do grupo, mesmo de outra equipe, porque uma queda geral cruza equipes de propósito. Se quiser, o líder passa a ver só títulos de chamados que ele pode abrir (e um título genérico no resto).
- Encerrar o incidente fecha o agrupamento por completo: chamados do grupo encerrado nunca mais entram em outro nem refazem o alarme; um incidente novo só nasce com chamados novos.
- Corrida: `closeFinishedIncidents` roda fora da trava consultiva da detecção; um chamado novo pode, raramente, cair num grupo que fecha no mesmo instante.
- A janela de 30 minutos é contada a partir do momento do job; se o provider ficar fora por mais de 30 minutos, o próprio chamado sai da janela e o incidente não é detectado.
- Selo "Possível duplicado" na lista pode aparecer mesmo quando todos os candidatos já foram resolvidos (o cartão, não).
- Qualquer mudança de status de chamado sem sugestão roda a busca de duplicados de novo (com a janela de 72 h a partir de agora).
- Dois pedidos de resumo simultâneos cobram o modelo duas vezes e um deles pode falhar com erro de unicidade.
- Editar título ou descrição não refaz o vetor do chamado aberto.
- A faixa de incidente consulta, a cada página, todos os chamados de cada grupo aberto só para contar; o `role="alert"` repete o anúncio a cada navegação.
- Casts `as never` em `getIncidentNotice` e `getDuplicatesView` escondem recursos incompletos do typecheck; `APP_URL` é lido de `process.env` direto.

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
