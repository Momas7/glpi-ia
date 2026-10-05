# Integração com o n8n

O sistema conversa com o n8n nos dois sentidos:

- **Saída:** a cada acontecimento relevante (chamado criado, atribuído, mudança de status, comentário público, convite, redefinição de senha), o sistema envia um aviso assinado para um webhook do n8n. O n8n decide o canal: e-mail, Teams, WhatsApp etc.
- **Entrada:** o n8n abre chamados e comenta neles por uma API com chave própria. Uma automação de e-mail, formulário ou WhatsApp vira chamado sem mudar nada no sistema.

## Requisitos no n8n (self-hosted)

- O nó Code precisa do módulo `crypto` para verificar a assinatura: defina `NODE_FUNCTION_ALLOW_BUILTIN=crypto` no ambiente do n8n.
- Para ler o segredo com `$env`, o acesso a variáveis de ambiente no nó Code precisa estar liberado (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). Se a sua política não permitir, guarde o segredo de outra forma aceita pela sua instalação (por exemplo, Variables) e ajuste o trecho.
- No nó **Webhook**, use **Respond: When Last Node Finishes** (ou um nó *Respond to Webhook* depois da verificação). Assim, assinatura inválida ou erro no workflow devolvem um código diferente de 2xx e o sistema tenta de novo. Com a resposta imediata, o sistema marca o aviso como entregue mesmo que o workflow quebre depois.

Na tela de integrações, **entregue** significa "o n8n respondeu 2xx". Com a configuração acima, isso equivale a "o workflow processou".

## Configuração

1. No n8n, crie um workflow com um nó **Webhook** (método `POST`). Em *Options*, ligue **Raw Body**: a assinatura é calculada sobre o corpo exato.
2. No servidor do sistema, defina no ambiente:
   - `N8N_WEBHOOK_URL`: a URL de produção desse webhook.
   - `N8N_WEBHOOK_SECRET`: um segredo com pelo menos 32 caracteres (`openssl rand -hex 32`). O mesmo valor vai no nó de verificação do n8n.
3. Para a entrada, em **Administração → Integrações**, crie uma chave de API com as permissões necessárias e copie o valor exibido (ele não aparece de novo).

Sem `N8N_WEBHOOK_URL`, os avisos só vão para o log do servidor, e **os links de redefinição de senha não chegam a ninguém**. Com Docker Compose, as duas variáveis vão no `.env` do projeto; o `docker-compose.yml` já as repassa ao `web` e ao `worker`.

## Avisos (saída)

Cada aviso é um `POST` com corpo JSON:

```json
{
  "id": "6f1c0e8e-2b0a-4d55-9a57-1b0f6b8f3a10",
  "type": "ticket.created",
  "occurredAt": "2026-10-02T12:00:00.000Z",
  "data": { "...": "..." }
}
```

Cabeçalhos:

| Cabeçalho | Conteúdo |
|---|---|
| `X-Event-Id` | O mesmo `id` do corpo. Use para descartar repetições. |
| `X-Timestamp` | Momento do envio, em segundos Unix. |
| `X-Signature` | `sha256=` + HMAC-SHA256 em hexadecimal de `timestamp + "." + corpo`, com o `N8N_WEBHOOK_SECRET`. |

**Entrega.** Respostas 2xx contam como entregue. Outras respostas, erros de rede e demoras acima de 10 s geram nova tentativa, com intervalo crescente, até 8 tentativas. Depois disso o aviso aparece em **Administração → Integrações → Avisos com falha**, com botão "Reenviar". A ordem de chegada não é garantida: use `occurredAt` e `id`.

### Eventos

Os eventos de chamado trazem só o necessário para notificar. **A descrição do chamado e o texto dos comentários nunca vão no aviso**; quem precisar do conteúdo segue o `url`.

`data` comum aos eventos de chamado:

```json
{
  "id": "cmuq…",
  "number": 42,
  "title": "Impressora do 2º andar não imprime",
  "status": "OPEN",
  "priority": "HIGH",
  "team": "Infraestrutura",
  "requester": { "name": "Ana Souza", "email": "ana@empresa.com" },
  "assignee": { "name": "Caio Lima", "email": "caio@empresa.com" },
  "url": "https://chamados.empresa.com/tickets/cmuq…"
}
```

| Evento | Quando | Campos além do comum |
|---|---|---|
| `ticket.created` | Chamado aberto (tela ou API) | — |
| `ticket.assigned` | Atribuído, assumido ou liberado pelo admin | `previousAssigneeId` |
| `ticket.status_changed` | Mudança de status, reabertura, confirmação ou fechamento automático | `from`, `to`; `automatic: true` no fechamento automático |
| `comment.created` | Comentário público (notas internas nunca geram aviso) | formato próprio: `{ ticket, commentId, author: { name, email } }` |
| `sla.warning` | Chamado com 80% do prazo de resolução consumido | (a partir do bloco de SLA) |
| `sla.breached` | Prazo de resolução vencido | (a partir do bloco de SLA) |
| `incident.detected` | Cinco ou mais chamados parecidos chegaram em pouco tempo (queda geral); uma vez por incidente | formato próprio: `{ id, title, ticketCount, teams, url, detectedAt }`; nunca traz descrição de chamado |
| `auth.invite_created` | Admin convidou alguém | formato próprio: `{ email, role, url, expiresAt }` |
| `auth.password_reset_requested` | Alguém pediu para redefinir a senha | formato próprio: `{ email, name, url, expiresAt }` |

Avisos reenviados pelo admin levam `"redelivery": true` em `data` e são remontados com o estado atual do chamado.

> **Atenção:** os links de `auth.invite_created` e `auth.password_reset_requested` dão acesso à conta. Mande-os só ao destinatário e **não os grave** em logs de execução, planilhas ou canais compartilhados. No n8n, desligue "Save Execution Progress" e o salvamento de execuções bem-sucedidas nesse workflow, ou remova o campo `url` antes de qualquer nó que registre dados.

### Verificar a assinatura no n8n

Logo depois do Webhook, adicione um nó **Code** com o trecho abaixo. Ele recusa avisos sem assinatura válida ou com mais de 5 minutos (proteção contra reenvio malicioso).

```js verificar-assinatura
const crypto = require('crypto');

function verificar({ segredo, timestamp, corpo, assinatura, agora = Math.floor(Date.now() / 1000) }) {
  if (!assinatura || Math.abs(agora - Number(timestamp)) > 300) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex');
  return esperado.length === assinatura.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(assinatura));
}
```

Uso no nó Code (modo *Run Once for Each Item*), com o segredo guardado como credencial ou variável de ambiente do n8n:

```js
const headers = $json.headers;
const corpo = Buffer.from($binary.data.data, 'base64').toString('utf8'); // Raw Body
const ok = verificar({
  segredo: $env.CHAMADOS_WEBHOOK_SECRET,
  timestamp: headers['x-timestamp'],
  corpo,
  assinatura: headers['x-signature'],
});
if (!ok) throw new Error('Assinatura inválida');
return { json: JSON.parse(corpo) };
```

## API de entrada

Base: `https://<seu-servidor>/api/v1`. Autenticação em todas as chamadas:

```
Authorization: Bearer gk_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
Content-Type: application/json
```

### Abrir chamado — `POST /api/v1/tickets`

Permissão da chave: **Abrir chamados** (`tickets:create`).

```json
{
  "requesterEmail": "ana@empresa.com",
  "title": "Sem acesso à pasta do financeiro",
  "description": "Desde hoje cedo aparece acesso negado.",
  "categoryName": "Acessos",
  "priority": "MEDIUM",
  "externalRef": "<CAF8.123@mail.empresa.com>"
}
```

- `requesterEmail` precisa ser de uma pessoa **cadastrada e ativa** (maiúsculas não importam). O sistema não cria contas a partir de e-mails desconhecidos.
- **O remetente de um e-mail pode ser forjado.** Em fluxos de e-mail, confira o cabeçalho `Authentication-Results` (SPF, DKIM e DMARC com `pass`) antes de chamar a API; sem isso, qualquer pessoa pode abrir chamado em nome de um colega.
- `categoryName` é opcional; uma categoria inexistente é ignorada e o chamado vai para a equipe de entrada.
- `priority`: `LOW`, `MEDIUM`, `HIGH` ou `CRITICAL` (opcional).
- `externalRef` torna a chamada **idempotente**: repetir o mesmo valor com a mesma chave devolve o chamado já criado, em vez de duplicar. Use o Message-ID do e-mail ou o id da mensagem de origem.

Respostas: `201` com `{ "ticket": { "id", "number", "url" } }` quando cria; `200` com o mesmo formato quando o `externalRef` já existia.

### Comentar — `POST /api/v1/tickets/{number}/comments`

Permissão da chave: **Comentar em chamados** (`comments:create`).

```json
{ "authorEmail": "ana@empresa.com", "body": "Segue o print do erro.", "externalRef": "<CAF9.456@mail.empresa.com>" }
```

Pela API, **só o solicitante do chamado** pode ser o autor: comentários de técnicos e administradores são feitos pela tela. Isso impede que um integrador (ou um e-mail com remetente forjado) publique comentário em nome da equipe. Comentários pela API são sempre públicos. `externalRef` repetido no mesmo chamado devolve `200` sem duplicar.

### Erros

| Código | Quando |
|---|---|
| 400 | Corpo inválido (campos faltando ou fora do formato); a resposta lista os campos. |
| 401 | Chave ausente, inválida ou revogada. |
| 403 | A chave não tem a permissão necessária, ou o autor do comentário não é o solicitante do chamado. |
| 404 | Chamado não encontrado (comentários). |
| 413 | Corpo maior que 64 KB. |
| 422 | `{"error": "requester_not_found"}`: solicitante não cadastrado ou desativado. Responda ao remetente pedindo que use o e-mail cadastrado. |
| 429 | Mais de 60 requisições por minuto com a mesma chave. Aguarde e tente de novo. |

## Workflow de exemplo: e-mail vira chamado

O arquivo [`docs/n8n/email-vira-chamado.json`](n8n/email-vira-chamado.json) pode ser importado no n8n (*Import from File*). Ele:

1. Lê a caixa de suporte por IMAP (marcando a mensagem como lida).
2. Descarta respostas automáticas e listas: `Auto-Submitted` diferente de `no`, `Precedence` `bulk`/`auto_reply`/`list`/`junk`, presença de `X-Autoreply`, `X-Autorespond`, `List-Id` ou `X-Auto-Response-Suppress`, e remetentes `mailer-daemon`, `postmaster` e `noreply`. Isso evita loops com mensagens de férias e com os próprios avisos do sistema.
3. Chama `POST /api/v1/tickets` com o remetente como solicitante, título `E-mail: <assunto>` e o Message-ID como `externalRef`. Falhas de rede, 429 e 5xx são tentadas de novo 3 vezes.
4. Se ainda assim falhar: com `422`, responde ao remetente explicando que o e-mail não está cadastrado; com qualquer outro erro, a execução para com erro.

Como a mensagem já foi marcada como lida, **configure um Error Workflow** nas opções do workflow para avisar a equipe quando uma execução falhar; senão o e-mail se perde em silêncio. Os nós de IF leem os cabeçalhos no formato `Nome: valor` que o nó IMAP entrega; confira numa execução real da sua versão do n8n.

Antes de ativar, ajuste as credenciais IMAP e SMTP, o remetente da resposta, a URL do servidor e a credencial *Header Auth* com `Authorization: Bearer <sua chave>`.
