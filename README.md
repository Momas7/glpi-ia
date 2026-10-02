# Chamados IA

Sistema de chamados no estilo GLPI com automações de IA: triagem automática, sugestão de resposta via RAG e resumo com detecção de duplicados e incidentes em massa. A IA propõe; uma pessoa decide.

> Em desenvolvimento por fases. GIF de demonstração e diagrama de arquitetura chegam ao longo das fases.

## Visão geral

- **Stack:** Next.js (App Router), PostgreSQL com pgvector, Prisma, pg-boss (sem Redis), Tailwind, shadcn/ui e componentes React Bits.
- **IA:** camada `LLMProvider` trocável por variável de ambiente (Gemini em desenvolvimento, Claude em produção).
- **Segurança:** dados sensíveis mascarados antes do LLM, log de auditoria de toda chamada de IA, a IA nunca fecha chamado sozinha.

## Arquitetura

Monólito modular com dois processos do mesmo código: `web` (UI e Route Handlers) e `worker` (jobs do pg-boss). Detalhes em [docs/superpowers/specs/2026-10-01-glpi-ia-design.md](docs/superpowers/specs/2026-10-01-glpi-ia-design.md).

## Rodando localmente

Requisitos: Node 24+, Docker (ou Podman).

```bash
cp .env.example .env        # ajuste SESSION_SECRET (openssl rand -hex 32)
npm install
docker compose up -d postgres
npx prisma migrate deploy
npm run db:seed             # dados fictícios
npm run dev                 # web em http://localhost:3000
npm run worker              # em outro terminal
```

Stack completa em containers: `docker compose up --build` (exige `SESSION_SECRET` no `.env`).

Testes: `npm test` (unitários) e `npm run test:integration` (precisa de Docker/Podman).

## Fases

| Fase | Entrega | Status |
|---|---|---|
| 0 | Setup: Compose, Prisma, CI, tema | concluída |
| 1 | Auth e CRUD de chamados | planejada |
| 2 | SLA, equipes, e-mail e dashboard | planejada |
| 3 | LLMProvider e triagem | planejada |
| 4 | RAG e sugestão de resposta | planejada |
| 5 | Resumo e duplicados | planejada |
| 6 | Métricas de IA e deploy | planejada |

## Licença

MIT, exceto `src/components/bits/` (React Bits). Veja [LICENSE](LICENSE) e [THIRD_PARTY.md](THIRD_PARTY.md).
