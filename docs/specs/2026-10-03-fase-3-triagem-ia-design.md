# Fase 3: provider de LLM, mascaração e triagem por IA — Design

Data: 2026-10-03 · Status: aprovado em conversa; execução autorizada · Spec base: `docs/specs/2026-10-01-glpi-ia-design.md` (seção 5)

## 1. Objetivo

Todo chamado novo recebe uma sugestão de categoria, prioridade e equipe, gerada por IA e decidida por uma pessoa. A infraestrutura de IA (provider, mascaração, auditoria, teto de gasto) nasce aqui e serve às Fases 4 e 5.

**Sucesso:**
- Chamado novo gera, em segundo plano, uma sugestão de triagem visível ao técnico.
- O técnico aceita, edita ou rejeita; a IA nunca muda o chamado sozinha.
- Nenhum dado sensível (CPF, e-mail, telefone, IP, cartão, tokens) sai para o LLM sem máscara.
- Trocar de Gemini para Claude é mudar `LLM_PROVIDER`.
- Tudo é auditado, e o CI roda sem chamar nenhuma API (provider `fake`).
- Material do post 3 do LinkedIn: a abstração Gemini↔Claude e a mascaração.

**Decisões já tomadas com o usuário:**
- A IA **só sugere**; aplicar exige clique de uma pessoa (sem aplicação automática nesta fase).
- Interface própria `LLMProvider` sobre os SDKs oficiais (`@google/genai`, `@anthropic-ai/sdk`).
- O usuário **ainda não tem chave de API**: a fase sai testada com o provider `fake`, com o Gemini pronto, e o usuário liga a chave depois.
- Escopo: só triagem. Embeddings, RAG, resumo e duplicados ficam nas Fases 4 e 5.

## 2. Abordagens escolhidas

| Decisão | Escolha | Alternativa descartada |
|---|---|---|
| Acesso aos LLMs | Interface própria sobre SDKs oficiais | Vercel AI SDK (menos controle de custo/auditoria); `fetch` direto (retrabalho) |
| Disparo da triagem | Job `ai.triage` enfileirado na transação que cria o chamado | Chamada síncrona na requisição (LLM lento trava o usuário) |
| Sem chave de API | Provider `fake` determinístico e IA desligada por padrão | Mock espalhado pelos testes |
| Aplicação da sugestão | Decisão humana, uma vez | Auto-aplicar com confiança alta (fora desta fase) |

## 3. Modelo de dados (acréscimos)

- `AiSuggestionKind { TRIAGE }` (os demais tipos entram nas fases seguintes) e `AiSuggestionStatus { PENDING, ACCEPTED, EDITED, REJECTED }`.
- `AiSuggestion`: `id`, `ticketId`, `kind`, `payload Json` (`{ categoryId, priority, teamId }`), `confidence Float`, `status`, `decidedById?`, `decidedAt?`, `createdAt`. Único `(ticketId, kind)`: uma triagem por chamado. Índice `(status, kind)`.
- `AiAuditLog`: `id`, `createdAt`, `provider`, `model`, `jobType`, `ticketId?`, `inputTokens`, `outputTokens`, `costUsd Decimal`, `latencyMs`, `inputHash`, `outcome` (`OK | FAILED | SKIPPED | BUDGET`), `error?`, `maskedInput?` (texto **mascarado**, limpo após 30 dias; nunca o prompt em claro). Índice `createdAt`.
- `Team.aiEnabled Boolean @default(true)`.
- Migração manual-assistida no mesmo padrão das anteriores.

## 4. Módulo `src/modules/ai/`

API pública em `index.ts`; nada fora do módulo importa arquivos internos, e **nenhum código fora do módulo importa um provider**.

**`provider/`**
- `LLMProvider.generate({ system, user, schema, model })` devolve `{ data, usage: { inputTokens, outputTokens } }`, com `data` validado por Zod.
- `gemini.ts` (`@google/genai`, saída estruturada em JSON) e `anthropic.ts` (`@anthropic-ai/sdk`, ferramenta de saída forçada). `fake.ts`: regras por palavra-chave, determinístico.
- `LLM_PROVIDER = fake | gemini | anthropic`. Provider sem chave configurada: a IA fica desligada e a administração mostra o motivo.
- Mapa tarefa→modelo em config (triagem: modelo pequeno).

**`masking/`**
- `mask(texto)` → `{ text, map }` e `unmask(texto, map)`. Tokens `[CPF_1]`, `[CNPJ_1]`, `[EMAIL_1]`, `[TEL_1]`, `[IP_1]`, `[CARTAO_1]`, `[SEGREDO_1]`. Mesmo valor, mesmo token.
- CPF/CNPJ só com dígito verificador válido; cartão só com Luhn; telefone BR; IPv4/IPv6; senhas e tokens por padrão (`senha: x`, `Bearer …`, `gk_…`, chaves longas).
- Texto que já contém algo parecido com um token (`[CPF_1]`) é neutralizado antes de mascarar, para que o `unmask` não injete valores trocados.
- **Limite documentado:** nomes próprios não são mascarados.

**`run.ts` (wrapper `runAi`)**
1. Confere `AI_ENABLED` e o teto diário (`AI_DAILY_BUDGET`, em USD, somando `costUsd` do dia).
2. Mascara a entrada.
3. Chama o provider com timeout e retry com espera crescente, só em erro temporário (429, 5xx, rede).
4. Desmascara a saída, grava o `AiAuditLog` (sucesso ou erro) e devolve o resultado.
- Custo estimado por tabela de preço por modelo em config; é estimativa.

**`triage.ts`**
- Entrada: título e descrição (limitados), lista de categorias e equipes ativas. Conteúdo do chamado vai dentro de um bloco delimitado como **dado**; o prompt de sistema manda ignorar instruções que estejam nele.
- Saída (Zod): `{ categoryId | null, priority, teamId | null, confidence 0..1 }`.
- Descarta ids inexistentes ou inativos. Abaixo de `AI_TRIAGE_MIN_CONFIDENCE` (padrão 0.6): nenhuma sugestão, só auditoria. Se nada sobrar para sugerir, não grava.
- Respeita `AI_ENABLED` global e `Team.aiEnabled` da equipe atual do chamado.
- Job `ai.triage` (pg-boss): idempotente (se já há sugestão, encerra), 3 tentativas, falha final só audita. Chamado segue normal sem IA.

**`decisions.ts`**
- `acceptSuggestion` e `editSuggestion` aplicam categoria, prioridade e equipe pelo serviço de chamados já existente (mesma regra de SLA, eventos e avisos de uma edição manual), em transação. `rejectSuggestion` só marca.
- Decisão única. Sugestão **obsoleta** (campos do chamado mudaram desde a criação ou o chamado já foi resolvido/fechado) é recusada com 409.
- Grava `AuditLog` com quem decidiu e o que mudou.
- Invariante: nenhum caminho da IA altera status do chamado.

## 5. Interface e permissões

- `can(user, "ai:decide", ticket)`: reaproveita a regra de quem pode editar o chamado (técnico da equipe, líder, admin); o solicitante nunca vê a sugestão.
- Cartão "Sugestão da IA" no detalhe do chamado: categoria, prioridade e equipe sugeridas, confiança, ações Aceitar, Editar e aplicar, Rejeitar. Some depois da decisão.
- Selo "IA sugeriu" na lista de chamados com sugestão pendente.
- Rotas: `POST /api/tickets/[id]/ai/triage/accept|edit|reject`, atrás de `withAuth` + `can`.
- Administração → IA (`admin:manage`): estado (ligada/desligada e por quê), provider e modelo, gasto do dia contra o teto, interruptor por equipe, taxa de aceite (aceitas, editadas, rejeitadas) e últimas execuções do `AiAuditLog` **sem texto de chamado**.

## 6. Configuração

`AI_ENABLED` (padrão `false`), `LLM_PROVIDER` (padrão `fake`), `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_DAILY_BUDGET`, `AI_TRIAGE_MIN_CONFIDENCE`, `AI_AUDIT_RETENTION_DAYS` (padrão 30). Validadas no `config.ts`; entram em `.env.example` e no `docker-compose.yml` (web e worker). Job diário `ai.audit_cleanup` apaga `maskedInput` vencido.

## 7. Testes e avaliação

- **Unitários:** mascaração (incluindo adversariais), schemas, custo, limiar, `FakeLLMProvider`, adaptadores com SDK simulado (formato do pedido, 429 vira retry, JSON inválido vira falha).
- **Integração (Postgres real):** criar chamado enfileira o job na mesma transação; worker gera `AiSuggestion` e `AiAuditLog`; IA desligada (global e por equipe) não gera nada; teto estourado pausa a IA sem afetar o chamado; aceitar/editar/rejeitar aplicam os campos certos e auditam; sugestão obsoleta recusada; id inexistente descartado; status nunca muda; autorização por papel.
- **E2E (Playwright):** técnico abre chamado novo, vê o cartão, aceita e confere os campos (provider fake).
- **Avaliação:** ~40 chamados rotulados em português (inclui ambíguos e injeção) e `npm run ai:eval` contra o provider configurado, com acerto por campo e custo. Fora do CI. Testado com o fake; números reais quando o usuário ligar o Gemini.

## 8. Riscos e limites

- Nomes próprios não são mascarados.
- Sem chave, a qualidade real da sugestão não é medida nesta entrega.
- O provider externo ainda vê o conteúdo restante após a máscara; documentar em privacidade.
- Custo: modelo pequeno, uma chamada por chamado, teto diário, fila absorve picos.

## 9. Fora desta fase

Embeddings, RAG, sugestão de resposta, resumo, duplicados, incidentes em massa e painel de métricas de IA (Fases 4 a 6); aplicação automática de sugestões.
