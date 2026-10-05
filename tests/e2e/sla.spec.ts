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

test("SLA: prazos na lista, vencidos, pausa em Pendente e tela do admin", async ({ browser }) => {
  // 1. Técnico vê a coluna de prazo e há chamados vencidos no seed
  const agent = await session(browser, "agente@demo.test");
  await expect(agent.page.getByRole("columnheader", { name: "Prazo" })).toBeVisible();
  await agent.page.getByRole("link", { name: "Vencidos" }).click();
  await expect(agent.page.getByText(/Vencido há/).first()).toBeVisible();

  // 2. Pendente pausa o prazo; voltar a Em andamento retoma
  await agent.page.goto("/tickets");
  await agent.page.getByPlaceholder("Buscar no título…").fill("Sem internet na sala de reuniões");
  await agent.page.getByRole("button", { name: "Filtrar" }).click();
  await agent.page.getByRole("link", { name: "Sem internet na sala de reuniões" }).click();
  await agent.page.getByRole("button", { name: /Marcar como pendente/i }).click();
  await expect(agent.page.getByText("Pausado", { exact: true })).toBeVisible();
  await agent.page.getByRole("button", { name: /Marcar como em andamento/i }).click();
  await expect(agent.page.getByText("Em andamento", { exact: true }).first()).toBeVisible();
  await expect(agent.page.getByText("Pausado", { exact: true })).toHaveCount(0);

  // 3. Admin muda o prazo de resolução da prioridade Baixa
  const admin = await session(browser, "admin@demo.test");
  await admin.page.goto("/admin/sla");
  const low = admin.page.getByLabel("Resolução (h úteis) — Baixa");
  await low.fill("48");
  await admin.page.getByRole("button", { name: "Salvar prazos" }).click();
  await expect(admin.page.getByText("Prazos salvos.")).toBeVisible();
  await admin.page.reload();
  await expect(admin.page.getByLabel("Resolução (h úteis) — Baixa")).toHaveValue("48");

  await agent.close();
  await admin.close();
});
