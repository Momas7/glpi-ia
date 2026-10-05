# Fase 4: base de conhecimento, RAG, rascunho de resposta, solução e avaliação — Design

Data: 2026-10-03 · Status: aprovado em conversa; aguardando revisão do plano · Spec base: `docs/specs/2026-10-01-glpi-ia-design.md` (seções 4 e 5) · Fase anterior: `docs/specs/2026-10-03-fase-3-triagem-ia-design.md`

## 1. Objetivo

O técnico pede, num chamado, um rascunho de resposta que cita as fontes (artigos da base de conhecimento e chamados já resolvidos). O sistema aprende com o próprio histórico: cada chamado resolvido passa a ter uma **solução** escrita, e o solicitante **avalia o atendimento**.

**Sucesso:**
- Líderes e admins cadastram e publicam artigos; técnicos os leem dentro do sistema.
- Artigos publicados e chamados resolvidos (com solução e sem nota baixa) são indexados em segundo plano (embeddings no pgvector).
- Em qualquer chamado, o técnico clica em "Sugerir resposta" e recebe um rascunho com citações `[1]`, `[2]`, gravado como nota interna `AI_DRAFT`. Nada é enviado ao solicitante sem uma pessoa.
- Sem fonte suficientemente parecida, o sistema avisa e **não** chama o modelo.
- Todo chamado resolvido tem solução. O solicitante avalia de 1 a 5 estrelas, com comentário.
- Material do post 4 do LinkedIn: RAG com citações e a mecânica de "aprender com o histórico".

**Decisões já tomadas com o usuário:**
- Fontes: chamados resolvidos **e** artigos escritos no sistema (sem importação de arquivos).
- Rascunho **sob demanda** (botão), nunca automático.
- Solução: campo obrigatório ao marcar Resolvido (mínimo de 10 caracteres). Chamados antigos sem solução usam o último comentário público de um técnico.
- Avaliação: estrelas e comentário opcionais dentro do "Confirmar fechamento"; depois, uma única vez, por até 30 dias após o fechamento. Nota 1 ou 2 tira o chamado da base. A média no dashboard fica para a Fase 6.
- Busca só vetorial (cosseno, HNSW), com limiar mínimo de similaridade.
- O usuário tem chave do Gemini com cota gratuita limitada: indexação em lote com pausa e retomada.

## 2. Abordagens escolhidas

| Decisão | Escolha | Alternativa descartada |
|---|---|---|
| Busca | Vetorial com limiar | Híbrida vetor + palavras (fica como evolução); só palavras (contraria o spec) |
| Rascunho | Sob demanda, nota interna, citações validadas | Automático em todo chamado (custo); envio direto (quebra a regra "humano decide") |
| Indexação | Jobs idempotentes por hash do conteúdo | Reindexar tudo a cada mudança |
| Remoção da base | Filtros também na consulta (publicado, estado, nota), além do job | Depender só do job (janela em que conteúdo retirado ainda aparece) |
| Edição de artigos | Telas em `/kb` (líder e admin editam, técnicos leem) | Dentro de `/admin` (o líder não entra lá) |

## 3. Modelo de dados (acréscimos)

- `Ticket.resolution String?` (texto da solução). `Comment.sources Json?` (fontes citadas de um rascunho: `[{ kind, id, number?, title }]`).
- `TicketRating`: `id`, `ticketId` (único), `raterId`, `stars Int` (1 a 5, `CHECK`), `comment String?` (até 1000), `createdAt`.
- `KbArticle`: `id`, `title`, `body` (Markdown), `published Boolean @default(false)`, `createdById`, `updatedById`, `createdAt`, `updatedAt`.
- `KbChunk`: `id`, `articleId` (cascade), `position Int`, `text`, `contentHash`, `embedding vector(768)`. Índice HNSW `vector_cosine_ops`.
- `TicketEmbedding`: `ticketId` (único, cascade), `contentHash`, `embedding vector(768)`, `indexedAt`. Índice HNSW.
- Colunas `vector` via SQL manual na migração (`Unsupported("vector(768)")` no schema); leitura e escrita por `$queryRaw`/`$executeRaw` parametrizados, num único repositório em `modules/ai`.

## 4. Embeddings (`src/modules/ai/embedding/`)

- `EmbeddingProvider.embed(texts, { kind: "document" | "query" })` devolve vetores de 768 dimensões e uso (tokens). `gemini` (SDK `@google/genai`, `embedContent`, `outputDimensionality: 768`, normalização L2 após o truncamento) e `fake` (vetor determinístico por palavras, para os testes acharem "parecidos" sem rede). `EMBEDDING_PROVIDER = fake | gemini` (padrão `fake`); sem chave, a IA conta como desligada.
- `runEmbed` (mesmo papel do `runAi`): `AI_ENABLED`, teto diário somando o custo de embeddings, **mascaração de cada texto**, retry com espera crescente só em erro temporário, auditoria (`jobType: "embed"`).
- Dimensão diferente de 768 é erro (nunca grava).

## 5. Indexação (`src/modules/ai/indexing.ts`)

- `chunkText(texto)`: trechos de ~800 caracteres com ~100 de sobreposição, quebrando em parágrafo quando possível.
- `indexArticle(id)`: artigo publicado e com mudança de hash → substitui os trechos; despublicado ou apagado → remove. `indexTicket(id)`: chamado RESOLVED ou CLOSED, com solução (ou, sem solução, o último comentário público de um técnico) e **sem nota 1 ou 2** → grava um vetor de `título + descrição + solução`; qualquer outro estado (reaberto, nota baixa) → remove. Notas internas nunca entram.
- Jobs `ai.index_article`, `ai.index_ticket` (enfileirados na transação que muda o dado) e `ai.reindex_all` (lotes de 10, pausa de 5 s entre lotes, pula o que tem hash igual, retoma se interrompido). Botão "Reindexar tudo" em Administração → IA e `npm run ai:reindex`.
- Com `AI_ENABLED` desligado nada é enfileirado; ao ligar, `Reindexar tudo` cobre o que ficou para trás.

## 6. Busca e rascunho

- `searchKnowledge(ator, { ticketId, texto }, { k = 6, minSimilarity })`: embedding da pergunta (`kind: "query"`, mascarada), consulta nas duas tabelas, similaridade = `1 - distância cosseno`, `AI_RAG_MIN_SIMILARITY` (padrão 0,6), no máximo 2 trechos por artigo. **Filtros na própria consulta:** artigo `published`; chamado só se o técnico tem acesso (ADMIN todos; demais: equipe do ator, responsável ou solicitante), estado RESOLVED/CLOSED e sem nota 1 ou 2; nunca o próprio chamado.
- `suggestDraft(ator, ticketId)` (permissão `ai:decide`): sem fontes → `NO_SOURCES` (o modelo grande não é chamado). Com fontes: modelo de rascunho (`AI_MODEL_DRAFT`; padrão Sonnet no Claude e o modelo da triagem no Gemini), fontes numeradas e o chamado como dados delimitados; saída `{ answer, citations: number[] }` validada: citações fora de `1..n` são descartadas e resposta sem nenhuma citação válida é recusada. Grava um `Comment` **interno** `AI_DRAFT` (autor: quem pediu) com `sources`; substitui o rascunho anterior do chamado. Não passa por `addComment` (sem SLA, sem aviso ao n8n).
- Rotas: `POST /api/tickets/[id]/ai/draft` (gera) e `DELETE` (descarta).

## 7. Telas e permissões

- Ações novas em `can()`: `kb:read` (técnicos, líderes, admin), `kb:manage` (líder e admin), `ticket:rate` (somente o solicitante do chamado; ADMIN não avalia por ele).
- `/kb` (lista pesquisável por título, leitura) e `/kb/[id]`; `/kb/new` e `/kb/[id]/edit` para quem tem `kb:manage` (salvar rascunho, publicar, despublicar, apagar com confirmação). Item "Base de conhecimento" no menu para a equipe.
- Marcar como Resolvido abre a caixa "Solução" (mín. 10 caracteres); a solução aparece destacada no chamado.
- Cartão do rascunho no chamado: texto editável com as marcas `[n]` removidas, fontes como links, **Publicar como comentário**, **Regenerar**, **Descartar**. O botão "Sugerir resposta" só aparece com a IA disponível.
- "Confirmar fechamento" ganha estrelas (acessíveis por teclado) e comentário opcionais; chamado fechado há até 30 dias mostra "Avalie o atendimento" uma única vez. A nota e o comentário aparecem no painel lateral do chamado para o solicitante e para a equipe.
- Administração → IA: contagem de artigos, trechos e chamados indexados, botão "Reindexar tudo".

## 8. Regras e configuração

- Invariantes da Fase 3 mantidas: a IA só escreve em suas tabelas e em comentários `AI_DRAFT` internos; nunca envia nada nem muda status; saída do LLM é não confiável; conteúdo de chamados, artigos e chamados antigos é dado, não instrução.
- Resolver sem solução é recusado (400) por **qualquer** caminho. Avaliação: única, nota 1 a 5, só em RESOLVED ou CLOSED (≤ 30 dias do fechamento), comentário sempre como texto.
- Novas variáveis: `EMBEDDING_PROVIDER` (`fake`), `AI_EMBEDDING_MODEL`, `AI_RAG_MIN_SIMILARITY` (0,6), `AI_MODEL_DRAFT`; entram em `.env.example`, `docker-compose.yml` e `config.ts`.

## 9. Testes e avaliação

- Unitários: `chunkText`, `fake` de embedding, normalização, schema do rascunho, componentes (rascunho, estrelas), adaptador do Gemini com SDK simulado.
- Integração (Postgres com pgvector): indexação e hash, remoção por despublicar/reabrir/nota baixa, busca (ordem, limiar, **nunca** outra equipe, rascunho de artigo, o próprio chamado ou nota interna), rascunho (nota interna, sem fonte não chama o modelo, citação inválida), resolução sem solução, avaliação (única, só o solicitante, janela, faixa da nota).
- E2E: líder publica artigo, técnico sugere resposta e vê as fontes; técnico resolve com solução; solicitante confirma com 5 estrelas e comentário.
- `npm run ai:eval:rag`: ~30 perguntas rotuladas contra uma base fictícia; mede se a fonte certa está no top 3 e se o rascunho cita só fontes reais. Fora do CI.

## 10. Riscos e limites

- Cota gratuita do Gemini: reindexação em lotes com pausa; qualidade real só medida com a chave ligada.
- Injeção por conteúdo indexado: fontes tratadas como dados; saída validada por formato e citações.
- Vazamento entre equipes: filtro de permissão na própria consulta, com teste dedicado.
- Trocar o modelo de embedding exige reindexar tudo; dimensão fixa em 768.
- Dados sensíveis: o que vira vetor e o que vai ao modelo passa pela mascaração (limite conhecido: nomes próprios).

## 11. Fora desta fase

Resumo de conversa, duplicados e incidente em massa (Fase 5); painel de métricas de IA e CSAT no dashboard (Fase 6); busca híbrida; portal de autoatendimento; importação de arquivos; anexos como fonte.
