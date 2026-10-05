import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "Demo-Fict1cia-Senha";
const NEW_TECH_PASSWORD = "Senha-Do-Novo-Tecnico-1";

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

async function session(browser: Browser, email: string, password = PASSWORD) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

test("gestão: admin convida, técnico entra e assume, solicitante reabre com motivo", async ({ browser }) => {
  const suffix = Date.now();
  const techEmail = `novo.tecnico.${suffix}@demo.test`;
  const title = `Impressora sem toner ${suffix}`;

  // 1. Admin convida um técnico e obtém o link
  const admin = await session(browser, "admin@demo.test");
  await admin.page.goto("/admin/usuarios");
  await admin.page.getByLabel("E-mail").fill(techEmail);
  await admin.page.getByLabel("Papel", { exact: true }).selectOption("AGENT");
  await admin.page.getByRole("button", { name: "Convidar" }).click();
  const inviteUrl = (await admin.page.getByTestId("invite-link").textContent())!.trim();
  expect(inviteUrl).toContain("/accept-invite?token=");

  // 2. O convidado cria a conta pelo link
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  await invitee.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, ""));
  await invitee.getByLabel("Nome").fill("Novo Técnico");
  await invitee.getByLabel("Senha").fill(NEW_TECH_PASSWORD);
  await invitee.getByRole("button", { name: "Criar conta" }).click();
  await expect(invitee).toHaveURL(/\/login$/);
  await inviteeContext.close();

  // 3. Admin coloca o novo técnico na equipe de entrada
  await admin.page.goto("/admin/equipes");
  await admin.page.getByLabel("Adicionar membro em Suporte N1").selectOption({ label: "Novo Técnico" });
  await expect(admin.page.getByText(techEmail)).toBeVisible();

  // 4. Solicitante abre chamado sem categoria (vai para a equipe de entrada)
  const requester = await session(browser, "solicitante@demo.test");
  await requester.page.goto("/tickets/new");
  await requester.page.getByLabel("Título").fill(title);
  await requester.page.getByLabel("Descrição").fill("Acabou o toner da impressora do RH.");
  await requester.page.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(requester.page.getByRole("heading", { name: title })).toBeVisible();
  const ticketUrl = requester.page.url();

  // 5. Novo técnico filtra a equipe, assume e resolve
  const tech = await session(browser, techEmail, NEW_TECH_PASSWORD);
  await tech.page.getByRole("link", { name: "Minha equipe" }).click();
  await tech.page.getByRole("link", { name: title }).click();
  await tech.page.getByRole("button", { name: "Assumir" }).click();
  await expect(tech.page.getByRole("button", { name: "Assumir" })).toHaveCount(0);
  await expect(tech.page.locator("dd", { hasText: "Novo Técnico" })).toBeVisible();
  await tech.page.getByRole("button", { name: /Marcar como em andamento/i }).click();
  await expect(tech.page.getByText("Em andamento", { exact: true }).first()).toBeVisible();
  await tech.page.getByRole("button", { name: /Marcar como resolvido/i }).click();
  await tech.page.getByLabel("Solução").fill("Reiniciei o equipamento e conferi o funcionamento.");
  await tech.page.getByRole("button", { name: "Resolver chamado" }).click();
  await expect(tech.page.getByText("Resolvido", { exact: true }).first()).toBeVisible();

  // 6. Solicitante reabre informando o motivo
  await requester.page.goto(ticketUrl);
  await requester.page.getByLabel("Motivo da reabertura").fill("Trocaram o toner, mas continua manchando.");
  await requester.page.getByRole("button", { name: "Reabrir" }).click();
  await expect(requester.page.getByText("Em andamento", { exact: true }).first()).toBeVisible();
  await expect(requester.page.getByText("Trocaram o toner, mas continua manchando.")).toBeVisible();

  for (const s of [admin, requester, tech]) await s.context.close();
});
