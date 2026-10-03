import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo-Fict1cia-Senha";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

test("painel de métricas e saúde do sistema", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, "admin@demo.test");

  // 1. O dashboard do admin mostra satisfação, IA no atendimento e uso e custo de IA, com o aviso de demonstração
  await admin.goto("/dashboard?period=last_90_days");
  const csat = admin.getByRole("region", { name: "Satisfação" });
  await expect(csat).toBeVisible();
  await expect(csat.getByText("Nota média")).toBeVisible();
  await expect(csat.getByText("Avaliações", { exact: true })).toBeVisible();
  await expect(admin.getByRole("region", { name: "IA no atendimento" }).getByText("Triagem aceita")).toBeVisible();
  const usage = admin.getByRole("region", { name: "Uso e custo de IA" });
  await expect(usage).toBeVisible();
  await expect(usage.getByRole("cell", { name: "triage" })).toBeVisible();
  await expect(admin.getByRole("note")).toContainText("Dados de demonstração incluídos");

  // 2. A página de saúde mostra as verificações (o worker do E2E bate o coração) e o backup como não configurado
  await expect(async () => {
    await admin.goto("/admin/saude");
    await expect(admin.getByText("Sistema saudável")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  const checks = admin.getByRole("region", { name: "Verificações" });
  for (const name of ["banco", "vetor", "migracoes", "fila", "worker"]) await expect(checks.getByText(name, { exact: true })).toBeVisible();
  await expect(admin.getByRole("region", { name: "Backup" })).toContainText("não configurado");
  await expect(admin.getByRole("region", { name: "Filas" })).toBeVisible();

  // 3. O endpoint de prontidão responde ok e devolve o id da requisição
  const ready = await admin.request.get("/api/health/ready");
  expect(ready.status()).toBe(200);
  expect((await ready.json()).status).toBe("ok");
  expect(ready.headers()["x-request-id"]).toBeTruthy();

  // 4. Técnico e solicitante não têm acesso à página de saúde nem ao dashboard
  for (const email of ["agente@demo.test", "solicitante@demo.test"]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, email);
    expect((await page.goto("/admin/saude"))?.status()).toBe(404);
    expect((await page.goto("/dashboard"))?.status()).toBe(404);
    await ctx.close();
  }
  await adminCtx.close();
});
