import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const PASSWORD = "Demo-Fict1cia-Senha";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

async function createTicket(request: APIRequestContext, title: string, description: string): Promise<string> {
  const res = await request.post("/api/tickets", { data: { title, description } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).ticket.id as string;
}

test("detecção: incidente em massa, duplicado ignorado, resumo e encerramento automático", async ({ browser }) => {
  const stamp = Date.now();
  // Vocabulário próprio, para não se misturar com chamados de outros testes.
  const words = ["alfa", "beta", "gama", "delta", "épsilon"];

  const requesterCtx = await browser.newContext();
  const requester = await requesterCtx.newPage();
  await login(requester, "solicitante@demo.test");

  // 1. Cinco chamados parecidos em poucos segundos: queda dos terminais de ponto eletrônico
  const ids: string[] = [];
  for (const [i, w] of words.entries()) {
    ids.push(
      await createTicket(
        requester.request,
        `Terminais de ponto eletrônico sem comunicação ${stamp} ${w}`,
        `Todos os terminais de ponto eletrônico do prédio mostram erro de comunicação com o servidor ${stamp} ${w} ${i}`,
      ),
    );
  }

  // 2. O admin vê a faixa do incidente e a página lista os cinco chamados
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, "admin@demo.test");
  const banner = admin.getByRole("alert").filter({ hasText: "Incidente em andamento" });
  await expect(async () => {
    await admin.goto("/tickets");
    await expect(banner).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 90_000 });
  await admin.getByRole("link", { name: /Terminais de ponto eletrônico/ }).first().click();
  await expect(admin.getByRole("heading", { name: "Incidentes" })).toBeVisible();
  const openSection = admin.locator("section").filter({ has: admin.getByRole("heading", { name: "Em andamento" }) });
  await expect(openSection.getByRole("link", { name: new RegExp(`ponto eletrônico sem comunicação ${stamp}`) })).toHaveCount(5);

  // 3. O técnico vê o aviso do incidente e o cartão de duplicados no último chamado, e ignora o duplicado
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agente@demo.test");
  await agent.goto(`/tickets/${ids[4]}`);
  await expect(agent.getByRole("status").filter({ hasText: "Parte do incidente" })).toBeVisible();
  await expect(async () => {
    await agent.reload();
    await expect(agent.getByRole("region", { name: "Possíveis duplicados" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await agent.getByRole("button", { name: "Não é duplicado" }).click();
  await expect(agent.getByRole("region", { name: "Possíveis duplicados" })).toHaveCount(0);

  // 4. Resumo de uma conversa com 3 comentários
  for (const body of ["Recebi o chamado.", "Os terminais perderam a comunicação.", "Vou reiniciar o servidor de ponto."]) {
    const res = await agent.request.post(`/api/tickets/${ids[0]}/comments`, { data: { body, internal: false } });
    expect(res.ok()).toBeTruthy();
  }
  await agent.goto(`/tickets/${ids[0]}`);
  await agent.getByRole("button", { name: "Resumir conversa" }).click();
  const summary = agent.getByRole("region", { name: "Resumo da conversa" });
  await expect(summary.getByText(/cobre 3 comentários/)).toBeVisible();

  // 5. O solicitante não vê faixa, duplicados nem resumo
  await requester.goto(`/tickets/${ids[0]}`);
  await expect(requester.getByRole("heading", { name: new RegExp(`ponto eletrônico sem comunicação ${stamp}`) })).toBeVisible();
  await expect(requester.getByText("Incidente em andamento")).toHaveCount(0);
  await expect(requester.getByText("Possíveis duplicados")).toHaveCount(0);
  await expect(requester.getByRole("button", { name: "Resumir conversa" })).toHaveCount(0);

  // 6. Resolver todos encerra o incidente sozinho
  for (const id of ids) {
    expect((await agent.request.patch(`/api/tickets/${id}`, { data: { status: "OPEN" } })).ok()).toBeTruthy();
    expect(
      (await agent.request.patch(`/api/tickets/${id}`, { data: { status: "RESOLVED", resolution: "Reiniciei o servidor de ponto eletrônico." } })).ok(),
    ).toBeTruthy();
  }
  await expect(async () => {
    await admin.goto("/incidentes");
    const closed = admin.locator("section").filter({ has: admin.getByRole("heading", { name: "Encerrados recentemente" }) });
    await expect(closed.getByRole("link", { name: new RegExp(`ponto eletrônico sem comunicação ${stamp}`) }).first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 90_000 });
  await expect(admin.getByRole("alert").filter({ hasText: "Incidente em andamento" })).toHaveCount(0);

  await requesterCtx.close();
  await adminCtx.close();
  await agentCtx.close();
});
