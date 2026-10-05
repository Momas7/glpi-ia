# IA no Sistema de Chamados

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

## Medir a qualidade

`npm run ai:eval` roda 40 chamados rotulados (`tests/ai-eval/dataset.json`, incluindo casos ambíguos, injeção de prompt e dados sensíveis) contra o provider configurado e imprime o acerto de categoria, prioridade e equipe, o custo estimado e os erros. Com provider real ele espera 6 s entre os casos (planos gratuitos limitam por minuto; ajuste com `AI_EVAL_DELAY_MS`) e repete em erro temporário. Fica fora do CI de propósito: chama o provider escolhido, custa dinheiro e o resultado varia. Com `LLM_PROVIDER=fake` o resultado só valida o funcionamento do script (as regras do fake são por palavra-chave e acertam pouco).

## Para desenvolvedores

Tudo vive em `src/modules/ai/`. Nada fora de `provider/` importa SDK de LLM: todo uso passa por `runAi` (teto de gasto, retry com espera crescente só em erro temporário, máscara, auditoria). O `FakeLLMProvider` é o único usado no CI e nos testes.
