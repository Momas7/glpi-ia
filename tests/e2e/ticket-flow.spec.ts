import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "Demo-Fict1cia-Senha";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

async function newSession(browser: Browser, email: string) {
  // E2E_VIDEO=1 grava o fluxo (usado para gerar o GIF do README; ver scripts/make-gif.sh).
  const context = await browser.newContext(
    process.env.E2E_VIDEO ? { recordVideo: { dir: "test-results/video", size: { width: 1024, height: 640 } } } : {},
  );
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

test("fluxo completo: solicitante abre, agente atende, nota interna fica oculta, chamado alheio dá 404", async ({
  browser,
}) => {
  const title = `Sem rede no setor ${Date.now()}`;

  // 1. Solicitante abre o chamado (categoria Rede → equipe Infraestrutura) e comenta
  const requester = await newSession(browser, "solicitante@demo.test");
  await requester.page.getByRole("link", { name: "Novo chamado" }).first().click();
  await requester.page.getByLabel("Título").fill(title);
  await requester.page.getByLabel("Descrição").fill("O Wi-Fi caiu e o cabo também não funciona.");
  await requester.page.getByLabel("Categoria").selectOption({ label: "Rede" });
  await requester.page.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(requester.page.getByRole("heading", { name: title })).toBeVisible();
  const ticketUrl = requester.page.url();

  await requester.page.getByLabel("Adicionar comentário").fill("Acontece desde as 9h.");
  await requester.page.getByRole("button", { name: "Comentar" }).click();
  await expect(requester.page.getByText("Acontece desde as 9h.")).toBeVisible();

  await requester.page.getByRole("link", { name: "Chamados" }).first().click();
  await expect(requester.page.getByRole("link", { name: title })).toBeVisible();

  // 2. Agente da equipe vê o chamado, escreve nota interna e muda o status
  const agent = await newSession(browser, "agente@demo.test");
  await agent.page.getByPlaceholder("Buscar no título…").fill(title);
  await agent.page.getByRole("button", { name: "Filtrar" }).click();
  await agent.page.getByRole("link", { name: title }).click();
  await agent.page.getByLabel("Adicionar comentário").fill("Verificar o switch do andar.");
  await agent.page.getByLabel(/Nota interna/).check();
  await agent.page.getByRole("button", { name: "Comentar" }).click();
  await expect(agent.page.getByText("Verificar o switch do andar.")).toBeVisible();

  await agent.page.getByRole("button", { name: /Marcar como em andamento/i }).click();
  await expect(agent.page.getByText("Em andamento", { exact: true }).first()).toBeVisible();
  await agent.page.getByRole("button", { name: /Marcar como resolvido/i }).click();
  await agent.page.getByLabel("Solução").fill("Reiniciei o equipamento e conferi o funcionamento.");
  await agent.page.getByRole("button", { name: "Resolver chamado" }).click();
  await expect(agent.page.getByText("Resolvido", { exact: true }).first()).toBeVisible();

  // 3. Solicitante vê a resolução, mas não a nota interna
  await requester.page.goto(ticketUrl);
  await expect(requester.page.getByText("Resolvido", { exact: true }).first()).toBeVisible();
  await expect(requester.page.getByText("Acontece desde as 9h.")).toBeVisible();
  await expect(requester.page.getByText("Verificar o switch do andar.")).toHaveCount(0);

  // 4. Chamado aberto pelo agente: o solicitante, ao abrir a URL direto, recebe 404
  await agent.page.getByRole("link", { name: "Novo chamado" }).first().click();
  await agent.page.getByLabel("Título").fill(`Chamado do agente ${Date.now()}`);
  await agent.page.getByLabel("Descrição").fill("Só o agente vê.");
  await agent.page.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(agent.page).toHaveURL(/\/tickets\/(?!new)[^/]+$/);
  const foreignUrl = agent.page.url();
  const response = await requester.page.goto(foreignUrl);
  expect(response?.status()).toBe(404);

  await requester.context.close();
  await agent.context.close();
});
