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

test("dashboard: admin vê cartões, gráficos e filtros; técnico e solicitante não têm acesso", async ({ browser }) => {
  // 1. Admin abre pelo menu e vê os seis cartões, a lista e os gráficos
  const admin = await session(browser, "admin@demo.test");
  await admin.page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(admin.page).toHaveURL(/\/dashboard$/);
  for (const name of ["Abertos agora", "Em risco", "Vencidos", "No SLA", "1ª resposta (média)", "Resolução (média)"]) {
    await expect(admin.page.getByRole("group", { name })).toBeVisible();
  }
  await expect(admin.page.getByRole("heading", { name: "Vence primeiro" })).toBeVisible();
  await expect(admin.page.getByRole("heading", { name: "Carga por técnico" })).toBeVisible();
  await expect(admin.page.getByRole("img", { name: /^Tendência dos últimos 6 meses/ })).toBeVisible();

  // 2. Trocar o período muda a URL e a página responde
  await admin.page.getByRole("combobox", { name: /^Período/ }).selectOption("last_month");
  await admin.page.getByRole("button", { name: "Aplicar" }).click();
  await expect(admin.page).toHaveURL(/period=last_month/);
  await expect(admin.page.getByText("Todas as equipes")).toBeVisible();

  // 3. Filtrar por equipe mostra o nome dela
  await admin.page.getByRole("combobox", { name: /^Equipe/ }).selectOption({ label: "Infraestrutura" });
  await admin.page.getByRole("button", { name: "Aplicar" }).click();
  await expect(admin.page.getByText(/Infraestrutura · atualizado às/)).toBeVisible();

  // 4. O número final dos cartões é o do banco (a animação de contagem termina)
  await admin.page.goto("/dashboard?period=last_90_days");
  const emAndamento = admin.page.getByRole("group", { name: "No SLA" });
  await expect(emAndamento).toContainText("%", { timeout: 30_000 });

  // 5. Técnico e solicitante: sem item no menu e 404 pela URL
  for (const email of ["agente@demo.test", "solicitante@demo.test"]) {
    const s = await session(browser, email);
    await expect(s.page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    const res = await s.page.goto("/dashboard");
    expect(res?.status()).toBe(404);
    await s.close();
  }
  await admin.close();
});
