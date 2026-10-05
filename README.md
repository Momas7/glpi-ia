# Sistema de Chamados

Sistema de chamados no estilo GLPI com automações de IA: triagem automática, sugestão de resposta via RAG e resumo com detecção de duplicados e incidentes em massa. A IA propõe; uma pessoa decide.

> Em desenvolvimento por fases. GIF de demonstração e diagrama de arquitetura chegam ao longo das fases.

## Visão geral

![Fluxo de atendimento](docs/media/ticket-flow.gif)

- **Stack:** TypeScript em Node.js 24 de ponta a ponta. Front em Next.js (App Router); API REST em Route Handlers do Next (Node); worker de jobs em Node com pg-boss (sem Redis); PostgreSQL com pgvector via Prisma; Tailwind, shadcn/ui e componentes React Bits.
- **IA:** camada `LLMProvider` trocável por variável de ambiente (Gemini em desenvolvimento, Claude em produção).
- **Integração com o n8n:** avisos assinados de tudo que acontece nos chamados e API para o n8n abrir chamados (ex.: e-mail vira chamado). Guia em [docs/integracao-n8n.md](docs/integracao-n8n.md).
- **Triagem por IA:** cada chamado novo recebe uma sugestão de categoria, prioridade e equipe (Gemini em desenvolvimento, Claude em produção, trocados por uma variável). A IA só sugere, o técnico decide; dados sensíveis são mascarados antes de sair e tudo é auditado. Guia em [docs/ia.md](docs/ia.md).
- **Base de conhecimento e RAG:** artigos escritos no sistema e chamados já resolvidos (com solução obrigatória) viram fontes de um rascunho de resposta com citações, sob demanda; o solicitante avalia o atendimento de 1 a 5 estrelas. Guia em [docs/ia.md](docs/ia.md).
- **Duplicados, incidentes e resumo:** o sistema avisa quando um chamado parece repetir outro da equipe, agrupa chamados parecidos que chegam juntos num incidente (faixa na tela e evento para o n8n) e resume conversas longas. Guia em [docs/ia.md](docs/ia.md).
- **Segurança:** dados sensíveis mascarados antes do LLM, log de auditoria de toda chamada de IA, a IA nunca fecha chamado sozinha.

## Arquitetura

Monólito modular com dois processos do mesmo código: `web` (UI e Route Handlers) e `worker` (jobs do pg-boss). Detalhes em [docs/specs/2026-10-01-glpi-ia-design.md](docs/specs/2026-10-01-glpi-ia-design.md).

## Rodando localmente

Requisitos: Node 24+, Docker (ou Podman).

```bash
cp .env.example .env        # preencha SESSION_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD (openssl rand -hex 16) e use a mesma senha no DATABASE_URL
npm install
docker compose up -d postgres
npx prisma migrate deploy
npm run db:seed             # dados fictícios
npm run dev                 # web em http://localhost:3000
npm run worker              # em outro terminal
```

Stack completa em containers: `docker compose up --build` (exige `SESSION_SECRET` e `POSTGRES_PASSWORD` no `.env`). O Postgres só escuta em `127.0.0.1`. Atenção: o Postgres aplica `POSTGRES_PASSWORD` apenas na primeira criação do volume; para trocar a senha, recrie o volume (`docker compose down -v`, que apaga os dados).

Testes: `npm test` (unitários), `npm run test:integration` (precisa de Docker/Podman) e `npm run test:e2e` (Playwright; `npx playwright install chromium` na primeira vez). O GIF acima é gerado por `scripts/make-gif.sh`.

## Primeiro administrador e produção

O cadastro é só por convite, e convites exigem um administrador. Na primeira instalação crie o primeiro direto no banco (a senha vem de variável de ambiente e passa pela política de 12 caracteres):

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
npm run admin:create -- --email voce@empresa.com --name "Seu Nome"
```

Rode também `npm run db:seed` (sem `SEED_DEMO_PASSWORD`): ele cria a equipe de entrada, categorias e equipes iniciais, as políticas de SLA, o expediente (seg–sex, 8h–18h) e os feriados nacionais. Tudo pode ser ajustado depois em **Administração**. Sem isso os chamados ficam sem prazo.

Notas para o ambiente real: o `web` só escuta em `127.0.0.1:3000` e deve ficar atrás de um proxy com HTTPS (Caddy, na Fase 6); o cookie de sessão é `Secure`, então acessar por `http://servidor:3000` não mantém o login. `TRUSTED_PROXY_HOPS` diz quantos proxies seus existem na frente (padrão 1). Não use `SEED_DEMO_PASSWORD` em produção.

## Fases

| Fase | Entrega | Status |
|---|---|---|
| 0 | Setup: Compose, Prisma, CI, tema | concluída |
| 1 | Auth e CRUD de chamados | concluída |
| 2 | SLA, equipes, e-mail e dashboard | planejada |
| 3 | LLMProvider e triagem | planejada |
| 4 | RAG e sugestão de resposta | planejada |
| 5 | Resumo e duplicados | planejada |
| 6 | Métricas de IA e deploy | planejada |

## Licença

MIT, exceto `src/components/bits/` (React Bits). Veja [LICENSE](LICENSE) e [THIRD_PARTY.md](THIRD_PARTY.md).
