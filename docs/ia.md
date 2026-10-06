# IA no Sentinela

A IA **só sugere**. Ela nunca muda o status de um chamado, nunca fecha nada e nunca aplica uma mudança sem um clique de uma pessoa.

## O que existe (Fase 3)

**Triagem.** Quando um chamado é criado (pela tela ou pela API), o sistema enfileira um job `ai.triage` na mesma transação. O worker pede ao LLM uma categoria, uma prioridade e uma equipe, e grava uma sugestão com a confiança. No chamado, o técnico da equipe (ou líder, ou admin) vê o cartão **Sugestão da IA** e escolhe: **Aceitar**, **Editar** ou **Rejeitar**. O solicitante nunca vê o cartão. Na lista, os chamados com sugestão pendente ganham o selo **IA sugeriu**.

- Confiança abaixo de `AI_TRIAGE_MIN_CONFIDENCE` (padrão 0,6): nenhuma sugestão é gravada.
- Se o modelo devolver categoria ou equipe que não existem, esse campo é descartado.
- Aceitar uma mudança de equipe tira o responsável atual (ele pode não ser da equipe nova) e o chamado volta à fila.
- Se o chamado mudou desde a sugestão, ou já foi resolvido, a decisão é recusada com 409.

**Auditoria.** Cada chamada ao LLM grava uma linha com provider, modelo, tokens, custo estimado, latência e resultado. O texto enviado ao modelo só é guardado **mascarado** e é apagado depois de `AI_AUDIT_RETENTION_DAYS` (padrão 30). Em **Administração → IA** o admin vê o estado, o gasto do dia, a taxa de aceite e as últimas execuções (sem texto de chamado).

## Ligar a IA

Tudo por variáveis de ambiente (`.env`); veja `.env.example`.

| Variável | Padrão | Para quê |
|---|---|---|
| `AI_ENABLED` | `false` | Interruptor geral. Desligado, nada é enviado a nenhum LLM. |
| `LLM_PROVIDER` | `fake` | `fake` (testes e demonstração, sem chave), `gemini` ou `anthropic`. |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | vazio | Chave do provider escolhido. Sem ela a IA conta como desligada e a tela explica o motivo. |
| `AI_MODEL_TRIAGE` | modelo pequeno do provider | `gemini-3.8-flash` ou `claude-haiku-4-5-20251001`. |
| `AI_DAILY_BUDGET` | `5` | Teto diário de gasto **estimado**, em USD. Estourado, a IA pausa até o dia seguinte e os chamados seguem normais. |
| `AI_TRIAGE_MIN_CONFIDENCE` | `0.6` | Limiar da sugestão. |
| `AI_AUDIT_RETENTION_DAYS` | `30` | Quanto tempo o texto mascarado fica no log. |

Para usar o Gemini no desenvolvimento: crie uma chave em <https://aistudio.google.com/apikey>, coloque `GEMINI_API_KEY` e `LLM_PROVIDER=gemini` no `.env` e `AI_ENABLED=true`, e reinicie o site e o worker. Em produção, troque para `LLM_PROVIDER=anthropic` e `ANTHROPIC_API_KEY`: nada mais muda. Cada equipe também pode ser desligada em **Administração → IA**.

## Privacidade

Antes de qualquer texto sair para o LLM, o sistema troca por tokens reversíveis: CPF e CNPJ (com dígito verificador válido), e-mail, telefone brasileiro, IPv4 e IPv6, cartão (checagem de Luhn) e senhas ou tokens em padrões comuns (`senha: ...`, `Bearer ...`, chaves `gk_...`). O mapa token → valor existe só em memória durante o job.

**Limites que você precisa conhecer:**
- **Nomes próprios não são mascarados.** Expressão regular não resolve isso. O texto restante do chamado, como o nome de uma pessoa ou de uma empresa, é visto pelo provider externo.
- A máscara é heurística: formatos incomuns de documento ou segredo podem passar. Os testes adversariais cobrem os formatos usuais, não todos.
- O texto do chamado vai ao modelo como **dado** delimitado, e a resposta só é aceita se bater com o formato esperado e apontar para categorias e equipes que existem. Isso reduz, mas não elimina, o risco de injeção de prompt: por isso a IA nunca age sozinha.


## Base de conhecimento e rascunho de resposta (Fase 4)

**Fontes.** A IA consulta duas coisas: os **artigos** da base de conhecimento (escritos no sistema por líderes e admins, em `/kb`; técnicos só leem) e os **chamados já resolvidos** (título, descrição e a **solução** escrita ao resolver). Só artigos *publicados* e chamados Resolvidos ou Fechados entram. Ficam de fora: notas internas, chamado reaberto e chamado com avaliação **1 ou 2 estrelas**.

**Indexação.** Cada artigo é dividido em trechos de ~800 caracteres; cada chamado resolvido vira um vetor. Os vetores (768 dimensões, Gemini) ficam no pgvector e a busca usa similaridade de cosseno. A indexação roda em segundo plano, é idempotente (hash do conteúdo) e acontece ao publicar/editar um artigo, ao resolver, ao reabrir e ao avaliar um chamado. Em **Administração → IA** há o botão *Reindexar tudo* (e `npm run ai:reindex`): use depois de ligar a IA, de trocar o modelo de embedding ou para indexar o histórico. A reindexação anda em lotes de 10 com pausa de 5 s e pode ser interrompida e repetida: o que já está atualizado é pulado, sem gastar cota (importante no plano gratuito do Gemini).

**Rascunho.** No chamado, o técnico clica em **Sugerir resposta**. O sistema busca as fontes mais parecidas (até 6, acima de `AI_RAG_MIN_SIMILARITY`) e, só se achar alguma, pede ao modelo um rascunho que **cita cada fonte**. O rascunho vira uma **nota interna** que só a equipe vê. O técnico edita e clica em *Publicar como comentário*; nada vai ao solicitante sem essa decisão. Sem fonte parecida, o modelo nem é chamado. Citações para fontes que não existem são descartadas, e uma resposta sem nenhuma citação válida é recusada. O técnico só vê como fonte chamados que ele mesmo pode abrir (a permissão é checada dentro da própria consulta).

**Solução e avaliação.** Marcar um chamado como Resolvido exige a **solução** (mínimo de 10 caracteres), que o solicitante também vê. O solicitante avalia o atendimento de 1 a 5 estrelas, com comentário opcional, ao confirmar o fechamento ou até 30 dias depois, uma única vez. A média no dashboard fica para a Fase 6.

| Variável | Padrão | Para quê |
|---|---|---|
| `EMBEDDING_PROVIDER` | `fake` | `fake` (testes) ou `gemini`. Usa a mesma `GEMINI_API_KEY`. |
| `AI_EMBEDDING_MODEL` | `gemini-embedding-001` | Trocar exige *Reindexar tudo*; a dimensão é fixa em 768. |
| `AI_RAG_MIN_SIMILARITY` | `0.6` | Abaixo disso uma fonte não é usada. |
| `AI_MODEL_DRAFT` | `claude-sonnet-5-5` (Claude) ou o modelo da triagem (Gemini) | Modelo do rascunho. |

**Limites.** O que vira vetor e o que vai ao modelo passa pela mascaração (nomes próprios continuam sem máscara). Artigos e chamados antigos podem conter instruções: elas são tratadas como dado, mas isso reduz, não elimina, o risco. A qualidade real depende do conteúdo da base e do histórico.

`npm run ai:eval:rag` roda 30 perguntas contra 12 artigos fictícios e mede se a fonte certa aparece no top 3 e se perguntas sem artigo ficam abaixo do limiar (fora do CI, consome cota; com `fake` só valida o script).


## Duplicados, incidentes e resumo (Fase 5)

**Possíveis duplicados.** Cada chamado novo ganha um vetor (título e descrição, mascarados) que fica guardado enquanto o chamado está aberto. O sistema compara com os chamados abertos **da mesma equipe** das últimas 72 horas e, se algum passar de `AI_DUPLICATE_MIN_SIMILARITY` (0,85), mostra ao técnico o cartão *Possíveis duplicados* (até 3, com link só para os que ele pode abrir) e o selo "Possível duplicado" na lista. O técnico só pode ignorar (**Não é duplicado**): nada é vinculado, mesclado ou fechado.

**Incidente em massa.** Se `AI_INCIDENT_MIN_TICKETS` (5) ou mais chamados abertos, **de qualquer equipe**, parecidos entre si (`AI_INCIDENT_MIN_SIMILARITY`, 0,75) chegarem em `AI_INCIDENT_WINDOW_MINUTES` (30), o sistema cria um **incidente**: uma faixa vermelha aparece para líderes e admins, a página *Incidentes* lista os chamados agrupados e o n8n recebe o evento `incident.detected` (uma vez por incidente; veja [integracao-n8n.md](integracao-n8n.md)). Novos chamados parecidos entram no mesmo grupo. O incidente fecha sozinho quando todos os chamados dele terminam, ou à mão (*Encerrar incidente*). O líder só vê incidentes que tenham chamado de uma equipe dele e, na página, só os chamados que pode abrir.

**Resumo da conversa.** No chamado, a equipe clica em **Resumir conversa** (a partir de 3 comentários). Notas internas entram no resumo, que só a equipe vê. Se a conversa avançar, o cartão avisa "há N comentários novos" e oferece **Atualizar resumo**. Rascunhos da IA não contam.

| Variável | Padrão | Para quê |
|---|---|---|
| `AI_DUPLICATE_MIN_SIMILARITY` / `AI_DUPLICATE_WINDOW_HOURS` | `0.85` / `72` | Limiar e janela dos duplicados. |
| `AI_INCIDENT_MIN_SIMILARITY` / `AI_INCIDENT_WINDOW_MINUTES` / `AI_INCIDENT_MIN_TICKETS` | `0.75` / `30` / `5` | Quando vários chamados viram incidente. |
| `AI_MODEL_SUMMARY` | o modelo do rascunho | Modelo do resumo. |

**Calibração.** Os padrões são conservadores. Com a chave real, rode `npm run ai:eval:dup`: ele compara ~40 pares rotulados (duplicados, quase duplicados e diferentes), mostra precisão, duplicados pegos e os erros, e sugere o limiar de melhor F1. Ajuste as duas variáveis de similaridade a partir dele (o limiar do incidente costuma ser um pouco menor que o de duplicados, porque descrições de uma queda geral variam mais).

**Limites.** O aviso é auxiliar: descrições vagas ("não funciona") geram vetores distantes e podem esconder um incidente. Um pico de chamados pode esgotar a cota de embeddings; nesse caso o chamado é criado normalmente, só fica sem vetor. Chamados de equipes com a IA desligada ficam fora de tudo isso.


## Métricas de IA (Fase 6)

O **Dashboard** ganha três seções, com os mesmos filtros de equipe e período:

- **Satisfação:** nota média (CSAT), número de avaliações, distribuição de 1 a 5 estrelas e tendência dos últimos 6 meses.
- **IA no atendimento:** taxa de aceite da triagem (sugestões aceitas ou editadas entre as decididas), rascunhos gerados e publicados, duplicados sugeridos e ignorados, resumos e incidentes.
- **Uso e custo de IA** (só admin): custo estimado por dia, chamadas, falhas, chamadas barradas pelo teto de gasto, tokens e latência mediana e p95 por tarefa (triagem, embedding, detecção, busca, rascunho e resumo).

**Como ler:** custo é estimativa (tabela de preços por modelo); "aceite" mostra o que a equipe decidiu, não a verdade absoluta; o rascunho "publicado" é o que o técnico enviou como comentário. O líder só soma chamados da própria equipe e nunca vê o uso e custo de IA.

**Dados de demonstração:** o seed cria meses de execuções de IA, sugestões e avaliações **fictícias**, todas marcadas (`demo`). Enquanto houver linhas assim no período, o painel avisa "Dados de demonstração incluídos". O uso real soma por cima. Nada disso é uso de empresa.

## Medir a qualidade

`npm run ai:eval` roda 40 chamados rotulados (`tests/ai-eval/dataset.json`, incluindo casos ambíguos, injeção de prompt e dados sensíveis) contra o provider configurado e imprime o acerto de categoria, prioridade e equipe, o custo estimado e os erros. Com provider real ele espera 6 s entre os casos (planos gratuitos limitam por minuto; ajuste com `AI_EVAL_DELAY_MS`) e repete em erro temporário. Fica fora do CI de propósito: chama o provider escolhido, custa dinheiro e o resultado varia. Com `LLM_PROVIDER=fake` o resultado só valida o funcionamento do script (as regras do fake são por palavra-chave e acertam pouco).

## Para desenvolvedores

Tudo vive em `src/modules/ai/`. Nada fora de `provider/` importa SDK de LLM: todo uso passa por `runAi` (teto de gasto, retry com espera crescente só em erro temporário, máscara, auditoria). O `FakeLLMProvider` é o único usado no CI e nos testes.
