import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "Demo-Fict1cia-Senha";

async function session(browser: Browser, email: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  return { page, close: () => context.close() };
}

test("integração: chave de API, chamado pelo 'n8n', técnico assume, chave revogada", async ({ browser, request }) => {
  const suffix = Date.now();
  const keyName = `n8n e-mail ${suffix}`;
  const title = `E-mail: sem acesso à VPN ${suffix}`;

  // 1. Admin cria a chave e lê o segredo exibido uma única vez
  const admin = await session(browser, "admin@demo.test");
  await admin.page.goto("/admin/integracoes");
  await admin.page.getByLabel("Nome da chave").fill(keyName);
  await admin.page.getByRole("button", { name: "Criar chave" }).click();
  const key = (await admin.page.getByTestId("api-key-secret").textContent())!.trim();
  expect(key).toMatch(/^gk_/);

  // 2. O "n8n" abre o chamado pela API; repetir com o mesmo externalRef não duplica
  const payload = {
    requesterEmail: "SOLICITANTE@demo.test",
    title,
    description: "Mensagem recebida na caixa de suporte.",
    categoryName: "acessos",
    externalRef: `<msg-${suffix}@mail.demo.test>`,
  };
  const headers = { authorization: `Bearer ${key}` };
  const first = await request.post("/api/v1/tickets", { headers, data: payload });
  expect(first.status()).toBe(201);
  const again = await request.post("/api/v1/tickets", { headers, data: payload });
  expect(again.status()).toBe(200);
  expect((await again.json()).ticket.number).toBe((await first.json()).ticket.number);

  // 3. Técnico da equipe vê o chamado, a origem e assume
  const agent = await session(browser, "agente@demo.test");
  await agent.page.getByRole("link", { name: "Minha equipe" }).click();
  await agent.page.getByRole("link", { name: title }).click();
  await expect(agent.page.getByText(`Aberto via API (${keyName})`)).toBeVisible();
  await agent.page.getByRole("button", { name: "Assumir" }).click();
  await expect(agent.page.getByRole("button", { name: "Assumir" })).toHaveCount(0);

  // 4. Admin revoga; a API passa a recusar
  await admin.page.getByRole("button", { name: `Revogar ${keyName}` }).click();
  await expect(admin.page.getByText("Revogada").first()).toBeVisible();
  const afterRevoke = await request.post("/api/v1/tickets", { headers, data: { ...payload, externalRef: `<outro-${suffix}>` } });
  expect(afterRevoke.status()).toBe(401);

  await admin.close();
  await agent.close();
});
