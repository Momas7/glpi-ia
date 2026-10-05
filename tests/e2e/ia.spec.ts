import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo-Fict1cia-Senha";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

test("triagem por IA: sugestão aparece ao técnico, é aceita e o solicitante não a vê", async ({ browser }) => {
  const title = `Wi-Fi caiu ${Date.now()}`;

  // 1. Solicitante abre o chamado sem categoria: ele cai na equipe de entrada
  const requesterCtx = await browser.newContext();
  const requester = await requesterCtx.newPage();
  await login(requester, "solicitante@demo.test");
  await requester.getByRole("link", { name: "Novo chamado" }).first().click();
  await requester.getByLabel("Título").fill(title);
  await requester.getByLabel("Descrição").fill("O Wi-Fi caiu e ninguém consegue conectar.");
  await requester.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(requester.getByRole("heading", { name: title })).toBeVisible();
  const ticketUrl = requester.url();

  // 2. O worker gera a sugestão em segundo plano: a lista mostra o selo
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agente@demo.test");
  await agent.getByPlaceholder("Buscar no título…").fill(title);
  await agent.getByRole("button", { name: "Filtrar" }).click();
  await expect(async () => {
    await agent.reload();
    await expect(agent.getByText("IA sugeriu")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });

  // 3. No chamado, o cartão mostra a sugestão; aceitar aplica categoria e equipe
  await agent.getByRole("link", { name: title }).click();
  const card = agent.getByRole("region", { name: "Sugestão da IA" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Rede")).toBeVisible();
  await card.getByRole("button", { name: "Aceitar" }).click();
  await expect(card).toHaveCount(0);
  await expect(agent.locator("dt:has-text('Categoria') + dd")).toHaveText("Rede");
  await expect(agent.locator("dt:has-text('Equipe') + dd")).toHaveText("Infraestrutura");

  // 4. O solicitante nunca vê o cartão
  await requester.goto(ticketUrl);
  await expect(requester.getByRole("heading", { name: title })).toBeVisible();
  await expect(requester.getByText("Sugestão da IA")).toHaveCount(0);

  await requesterCtx.close();
  await agentCtx.close();
});
