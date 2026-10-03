# Fase 2.4: Dashboard — Plano de Implementação

Passos com checkbox (`- [ ]`) para acompanhar a execução tarefa por tarefa.

**Goal:** Tela `/dashboard` para líderes e admin com a fila do dia (em risco, vencidos, vence primeiro, carga por técnico) e a visão do mês (SLA cumprido, tempos médios, volume, tendência de 6 meses).

**Architecture:** Consultas agregadas parametrizadas em `src/modules/dashboard/queries.ts` sobre os campos de SLA já gravados (blocos 2.3), com cache em memória de 60 s por (equipes, período). Autorização central em `getDashboard(actor, filtro)`: o líder só enxerga as próprias equipes. A tela é um Server Component; cartões animados (React Bits `CountUp`) e gráficos (shadcn chart, Recharts) são Client Components que só recebem dados prontos.

**Tech Stack:** Next.js 16, Prisma 7 (`$queryRaw` com `Prisma.sql`), shadcn chart (Recharts), React Bits CountUp (TS-TW), Vitest + Testcontainers, Playwright.

**Spec:** `docs/specs/2026-10-02-fase-2-design.md` (seção 7 e item 4 da seção 8).

**Base:** depende do bloco 2.3 (SLA). O branch sai de `fase-2-3-sla` (PR #10) e usa o menu lateral, que é entregue antes por outra mudança (ver nota abaixo).

> **Pré-requisito de interface:** o item "Dashboard" entra no menu lateral do app. Se o menu lateral ainda não existir quando esta execução começar, a Task 5 adiciona o link ao cabeçalho atual e a navegação é migrada junto com o menu depois.

## Global Constraints

- Acesso: `can(user, "dashboard:view")` só para TEAM_LEAD (restrito às equipes dele) e ADMIN (todas, com filtro). Líder pedindo equipe que não é dele recebe 403; técnico e solicitante recebem 404 na página.
- Período (fuso `APP_TIMEZONE`, intervalo fechado no início e aberto no fim): `this_month`, `last_month`, `last_30_days`, `last_90_days`. Padrão `this_month`.
- "Aberto" = status NEW, OPEN ou PENDING. Em risco = aberto, não pausado, `slaWarnedAt` preenchido e `resolutionDue >= agora`. Vencido = aberto, não pausado, `resolutionDue < agora`.
- % no SLA do período = chamados com `resolvedAt` no período e `resolutionDue` não nulo, contando os com `resolvedAt <= resolutionDue`. Chamado sem prazo não entra no numerador nem no denominador. Sem dados: `null` (a tela mostra "—"), nunca `NaN`.
- Tempos médios: média de `firstResponseBusinessMinutes` (respondidos no período) e de `resolutionBusinessMinutes` (resolvidos no período), em minutos úteis, exibidos em horas úteis; sem dados: `null`.
- Consultas parametrizadas (`Prisma.sql`), nunca concatenação; lista de equipes por `= ANY(...)`.
- Cache de 60 s por chave (equipes ordenadas + período); `clearDashboardCache()` para testes.
- Cartões usam `CountUp` do React Bits (cópia em `src/components/bits/`, licença em `THIRD_PARTY.md`) e ficam estáticos com `prefers-reduced-motion`. Gráficos legíveis em tema escuro, com texto alternativo (`aria-label`) resumindo cada gráfico.
- Textos em português; Next 16: consultar `node_modules/next/dist/docs/` antes de usar API do Next.

## Review Focus

- Chamado resolvido às 23h30 do último dia do mês (horário de São Paulo, já dia seguinte em UTC) conta no mês certo. → Task 1.
- Período sem nenhum chamado: tudo zero ou "—", sem `NaN`, sem erro e sem gráfico quebrado. → Tasks 2, 3 e 5.
- Líder pedindo a equipe de outro líder, ou `teamId` inexistente: 403 / 400, e nunca dados da outra equipe. → Task 3.
- Chamados sem prazo (anteriores ao SLA) não distorcem o % no SLA nem as médias. → Task 2.
- Chamado reaberto e resolvido de novo não é contado duas vezes no período. → Task 2.

## Estrutura de arquivos

```
src/modules/auth/can.ts                      # + dashboard:view
src/modules/dashboard/period.ts              # periodRange (puro)
src/modules/dashboard/queries.ts             # consultas agregadas
src/modules/dashboard/index.ts               # getDashboard (autorização + cache), clearDashboardCache
src/app/(app)/dashboard/page.tsx             # tela
src/components/dashboard/KpiCards.tsx        # cartões (CountUp)
src/components/dashboard/Charts.tsx          # gráficos (shadcn chart)
src/components/dashboard/Filters.tsx         # equipe e período
src/components/bits/CountUp.tsx              # React Bits
prisma/seed.ts                               # histórico fictício de 6 meses
```

---

### Task 1: Permissão e períodos

**Files:**
- Modify: `src/modules/auth/can.ts`, `src/modules/auth/index.ts`
- Create: `src/modules/dashboard/period.ts`
- Test: `tests/unit/can.test.ts`, `tests/unit/dashboard-period.test.ts`

**Interfaces:**
- Produces:
  - `Action` ganha `"dashboard:view"`: TEAM_LEAD e ADMIN → true; AGENT e REQUESTER → false.
  - `type Period = "this_month" | "last_month" | "last_30_days" | "last_90_days"`.
  - `periodRange(period: Period, now: Date, timeZone: string): { from: Date; to: Date }` (`from` incluso, `to` excluso): `this_month` = 1º dia do mês corrente 00:00 local até 1º do mês seguinte; `last_month` = mês anterior inteiro; `last_30_days` e `last_90_days` = últimos N dias terminando no início do dia seguinte ao de `now` (local).
  - `monthStarts(now: Date, timeZone: string, months: number): Date[]`: inícios dos últimos `months` meses locais, do mais antigo ao atual (para a tendência).

- [ ] **Step 1: Write the failing tests**
  - `can.test.ts`: `dashboard:view` verdadeiro para TEAM_LEAD e ADMIN, falso para AGENT e REQUESTER.
  - `dashboard-period.test.ts` (com `process.env.TZ = "UTC"`, fuso `America/Sao_Paulo`): `this_month` em 15/10/2026 → de 01/10 00:00 a 01/11 00:00 (instantes locais de São Paulo); `last_month` em 02/03/2026 → fevereiro inteiro (28 dias); `last_30_days` em 15/10 termina em 16/10 00:00 local e começa 30 dias antes; um instante 31/10/2026 23:30 locais pertence a `this_month` de outubro (e não de novembro); `monthStarts(now, tz, 6)` devolve 6 inícios consecutivos.
- [ ] **Step 2: Run** `npx vitest run tests/unit/can.test.ts tests/unit/dashboard-period.test.ts` → FAIL.
- [ ] **Step 3: Implement** (reaproveitar `TZDate` de `@date-fns/tz`, como o calendário de SLA).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): permissão e períodos no fuso da empresa`.

### Task 2: Números principais (consultas)

**Files:**
- Create: `src/modules/dashboard/queries.ts`
- Test: `tests/integration/dashboard-kpis.test.ts`

**Interfaces:**
- Consumes: `periodRange` (Task 1); campos de SLA do `Ticket`.
- Produces: `interface Scope { teamIds: string[] | null /* null = todas */ }` e
  - `queryKpis(scope: Scope, period: { from: Date; to: Date }, now: Date): Promise<{ openNow: number; openUnassigned: number; atRisk: number; breached: number; slaPercent: number | null; avgFirstResponseMinutes: number | null; avgResolutionMinutes: number | null }>`.

- [ ] **Step 1: Write the failing tests** (conjunto fixo de chamados com `createdAt`, `resolvedAt`, prazos e minutos úteis gravados direto, sem depender do relógio)
  - Contagens: 5 abertos (2 sem responsável), 1 em risco, 1 vencido, 1 pausado vencido (não conta como vencido), 1 fechado vencido (não conta).
  - `slaPercent`: 4 resolvidos no período com prazo, 3 dentro e 1 fora → 75; um resolvido sem prazo e um resolvido fora do período não entram; período sem resolvidos → `null`.
  - Médias: só dos que têm os minutos gravados; sem nenhum → `null`.
  - Chamado resolvido às 23h30 de 31/10 (horário de São Paulo) entra em outubro e não em novembro.
  - Chamado reaberto e resolvido de novo (um só `resolvedAt` final) conta uma vez.
  - Filtro de equipes: `teamIds: [t1]` ignora chamados de `t2`; `teamIds: []` devolve zeros.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.mts tests/integration/dashboard-kpis.test.ts` → FAIL.
- [ ] **Step 3: Implement** com `Prisma.sql` (um `SELECT` com `COUNT(*) FILTER (WHERE ...)` e `AVG(...) FILTER (...)`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): números principais (abertos, risco, SLA e tempos médios)`.

### Task 3: Listas, gráficos e `getDashboard`

**Files:**
- Modify: `src/modules/dashboard/queries.ts`
- Create: `src/modules/dashboard/index.ts`
- Test: `tests/integration/dashboard-queries.test.ts`, `tests/integration/dashboard-access.test.ts`

**Interfaces:**
- Produces (em `queries.ts`):
  - `queryDueSoon(scope, now, limit = 10): Promise<{ id; number; title; team: string | null; assignee: string | null; resolutionDue: Date; breached: boolean }[]>` (abertos não pausados, em risco ou vencidos, por `slaSortDue` crescente).
  - `queryWorkload(scope, now): Promise<{ assigneeId; name; open: number; atRisk: number; breached: number }[]>` (por responsável, mais carga primeiro).
  - `queryWeekly(scope, period, timeZone): Promise<{ weekStart: string /* YYYY-MM-DD */; created: number; resolved: number }[]>` (semanas locais; semanas sem chamados aparecem com zeros).
  - `queryByCategory(scope, period): Promise<{ category: string; count: number }[]>` (chamados criados no período; sem categoria = "Sem categoria").
  - `querySlaByTeam(scope, period): Promise<{ team: string; percent: number | null; resolved: number }[]>`.
  - `queryTrend(scope, months: Date[], timeZone): Promise<{ month: string /* YYYY-MM */; created: number; slaPercent: number | null }[]>`.
- Produces (em `index.ts`):
  - `getDashboard(actor: SessionUser, filter: { teamId?: string; period?: Period }, now?: Date): Promise<DashboardData>` com `DashboardData = { period; scopeLabel; kpis; dueSoon; workload; weekly; byCategory; slaByTeam; trend; generatedAt }`. Autorização: sem `dashboard:view` → `ForbiddenError`; líder: escopo = interseção com as próprias equipes, `teamId` de outra equipe → 403; admin: `teamId` opcional, inexistente → 400.
  - `clearDashboardCache(): void` (cache de 60 s por `(escopo ordenado, período)`).

- [ ] **Step 1: Write the failing tests**
  - `dashboard-queries.test.ts`: cada consulta contra o conjunto fixo (valores esperados explícitos): "vence primeiro" ordenado e sem pausados nem fechados; carga por técnico; semanas com zeros nas lacunas; categoria "Sem categoria"; % por equipe; tendência de 6 meses com mês sem chamados em zero e `slaPercent` nulo.
  - `dashboard-access.test.ts`: AGENT e REQUESTER → 403; líder sem `teamId` vê só os chamados das equipes dele; líder com `teamId` de outra equipe → 403; admin sem filtro vê tudo e com `teamId` vê só a equipe; `teamId` inexistente (admin) → 400; duas chamadas seguidas usam o cache (segunda não consulta o banco: criar um chamado entre elas e conferir que os números não mudam até `clearDashboardCache()`).
- [ ] **Step 2: Run** os dois arquivos → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run test:integration` verde.
- [ ] **Step 5: Commit** `feat(dashboard): listas, gráficos, autorização e cache`.

### Task 4: Cartões animados e página (sem gráficos)

**Files:**
- Create: `src/components/bits/CountUp.tsx` (via `npx shadcn@latest add @react-bits/CountUp-TS-TW`), `src/components/dashboard/KpiCards.tsx`, `src/components/dashboard/Filters.tsx`, `src/app/(app)/dashboard/page.tsx`
- Modify: `THIRD_PARTY.md` (listar `CountUp`), navegação do app (item "Dashboard" para TEAM_LEAD e ADMIN)
- Test: `tests/unit/kpi-cards.test.tsx`, `tests/unit/dashboard-guard.test.ts`

**Interfaces:**
- Produces:
  - `<KpiCards kpis={...} />`: cartões "Abertos agora" (com "N sem responsável"), "Em risco", "Vencidos", "% no SLA", "1ª resposta (média)", "Resolução (média)"; números com `CountUp`; valor `null` mostra "—"; tempos em horas úteis (`formatBusinessDuration`).
  - `<DashboardFilters teams={...} selectedTeamId period />`: formulário GET (equipe só para ADMIN; líder com mais de uma equipe também vê o seletor).
  - Página `/dashboard`: `assertDashboardPage(user)` chama `notFound()` sem `dashboard:view`; lê `searchParams` (`team`, `period`) validados com Zod; erro 403/400 do `getDashboard` vira a tela de "Sem permissão" ou "Equipe inválida" sem quebrar.

- [ ] **Step 1: Write the failing tests**
  - `kpi-cards.test.tsx` (jsdom): com `reduced-motion` o valor final aparece direto; `null` vira "—"; "3 sem responsável" aparece; tempo médio 450 min mostra "7 h 30 min".
  - `dashboard-guard.test.ts`: `assertDashboardPage` chama `notFound()` para AGENT e REQUESTER e deixa TEAM_LEAD e ADMIN passarem.
- [ ] **Step 2: Run** `npx vitest run tests/unit/kpi-cards.test.tsx tests/unit/dashboard-guard.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Instalar o `CountUp` (conferir a licença em `THIRD_PARTY.md`), construir cartões e página.
- [ ] **Step 4: Run** → PASS; typecheck e lint limpos; conferir no navegador com o seed.
- [ ] **Step 5: Commit** `feat(dashboard): página com cartões e filtros`.

### Task 5: Gráficos e listas na página

**Files:**
- Create: `src/components/ui/chart.tsx` (via `npx shadcn@latest add chart`), `src/components/dashboard/Charts.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Test: `tests/unit/dashboard-charts.test.tsx`

**Interfaces:**
- Produces: `<WeeklyChart data />` (criados × resolvidos por semana), `<CategoryChart data />`, `<TeamSlaChart data />`, `<TrendChart data />` (volume e % no SLA); tabela "Vence primeiro" com link para cada chamado e badge de vencido; tabela "Carga por técnico". Cada gráfico tem `role="img"` e `aria-label` resumindo os valores (ex.: "Chamados por semana: 12 criados e 9 resolvidos na semana de 05/10").

- [ ] **Step 1: Write the failing test** `dashboard-charts.test.tsx` (jsdom): com dados vazios, cada gráfico mostra a mensagem "Sem dados no período" em vez de quebrar; com dados, o `aria-label` resume o total; a lista "Vence primeiro" mostra o número e o link `/tickets/<id>`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/dashboard-charts.test.tsx` → FAIL.
- [ ] **Step 3: Implement** (Recharts em modo cliente; cores do tema escuro; sem animação com `prefers-reduced-motion`).
- [ ] **Step 4: Run** → PASS; conferir no navegador (desktop e largura de celular).
- [ ] **Step 5: Commit** `feat(dashboard): gráficos, vence primeiro e carga por técnico`.

### Task 6: Seed com 6 meses de histórico

**Files:**
- Modify: `prisma/seed.ts`
- Test: `tests/integration/seed.test.ts`

**Interfaces:**
- Produces: `seedHistory(db)` (dentro de `seedDemo`): cerca de 180 chamados fictícios resolvidos ou fechados nos últimos 6 meses, espalhados entre as equipes, categorias e prioridades, com `createdAt`, `resolvedAt`, `resolutionDue`, `firstResponseBusinessMinutes` e `resolutionBusinessMinutes` coerentes, cerca de 80% dentro do prazo; gerador pseudoaleatório com semente fixa (mesmo resultado a cada execução) e idempotente (não cria de novo se já existir histórico).

- [ ] **Step 1: Write the failing test** em `seed.test.ts`: com a senha demo, rodar o seed duas vezes → entre 150 e 220 chamados históricos, distribuídos em 6 meses distintos, todos com `resolvedAt` ≥ `createdAt`, e entre 70% e 90% com `resolvedAt <= resolutionDue`.
- [ ] **Step 2: Run** o teste → FAIL.
- [ ] **Step 3: Implement** (usar `slaOnCreate` e depois gravar `resolvedAt` e os minutos úteis).
- [ ] **Step 4: Run** → PASS; conferir o dashboard com o histórico no navegador.
- [ ] **Step 5: Commit** `feat(seed): histórico fictício de 6 meses para o dashboard`.

### Task 7: E2E do dashboard

**Files:**
- Create: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: seed demo; o menu com "Dashboard".

- [ ] **Step 1: Write the failing test**
  - Admin abre `/dashboard`: vê os seis cartões, o gráfico da tendência e a tabela "Vence primeiro"; troca o período para "Mês passado" e a URL e os números mudam.
  - Admin escolhe uma equipe e os números mudam.
  - O agente demo abre `/dashboard` e recebe 404; o solicitante também.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/dashboard.spec.ts` → FAIL.
- [ ] **Step 3: Implement** o que o teste revelar.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `test: E2E do dashboard`.

---

## Auto-revisão

- **Cobertura do spec (seção 7):** acesso e escopo (Tasks 1 e 3); filtros e fuso (Tasks 1 e 4); cartões com contagem e reduced-motion (Task 4); "vence primeiro" e carga por técnico (Tasks 3 e 5); criados × resolvidos, categoria, % por equipe e tendência de 6 meses (Tasks 3 e 5); consultas parametrizadas com cache de 60 s (Task 3); seed de 6 meses (Task 6); testes de números exatos e de 403 (Tasks 2, 3 e 7). Fora do escopo, como no spec: exportar CSV/PDF e metas por equipe.
- **Decisões que detalham o spec:** "em risco" e "vencido" usam as mesmas definições da lista de chamados; chamados sem prazo ficam fora do % no SLA; sem dados o valor é `null` e a tela mostra "—".
- **Consistência de tipos:** `Period`, `periodRange`, `monthStarts`, `Scope`, `query*`, `getDashboard`, `clearDashboardCache` com os mesmos nomes onde são consumidos.
- **Review Focus:** fuso no limite do mês → Tasks 1 e 2; período vazio → Tasks 2, 3 e 5; líder de outra equipe → Task 3; chamados sem prazo → Task 2; reaberto e resolvido de novo → Task 2.
