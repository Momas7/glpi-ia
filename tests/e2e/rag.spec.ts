import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo-Fict1cia-Senha";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

test("RAG: artigo publicado vira fonte do rascunho; solução e avaliação fecham o ciclo", async ({ browser }) => {
  const stamp = Date.now();
  const articleTitle = `Wi-Fi do segundo andar sem conexão ${stamp}`;
  const ticketTitle = `Wi-Fi do segundo andar sem conexão ${stamp}`;

  // 1. O administrador (também gerencia a base) publica um artigo
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, "admin@demo.test");
  await admin.getByRole("link", { name: "Base de conhecimento" }).first().click();
  await admin.getByRole("link", { name: "Novo artigo" }).click();
  await admin.getByLabel("Título").fill(articleTitle);
  await admin
    .getByLabel("Texto")
    .fill("Wi-Fi do segundo andar sem conexão: reinicie o ponto de acesso do segundo andar e confira o cabo de rede.");
  await admin.getByRole("button", { name: "Publicar" }).click();
  await expect(admin.getByRole("heading", { name: articleTitle })).toBeVisible();
  await expect(admin.getByText("Publicado", { exact: true })).toBeVisible();

  // 2. O solicitante abre um chamado parecido
  const requesterCtx = await browser.newContext();
  const requester = await requesterCtx.newPage();
  await login(requester, "solicitante@demo.test");
  await requester.getByRole("link", { name: "Novo chamado" }).first().click();
  await requester.getByLabel("Título").fill(ticketTitle);
  await requester.getByLabel("Descrição").fill("O Wi-Fi do segundo andar está sem conexão desde cedo.");
  await requester.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(requester.getByRole("heading", { name: ticketTitle })).toBeVisible();
  const ticketUrl = requester.url();
  await expect(requester.getByRole("button", { name: "Sugerir resposta" })).toHaveCount(0);

  // 3. O técnico pede o rascunho: o worker indexa o artigo em segundo plano, então tenta até as fontes aparecerem
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agente@demo.test");
  await agent.goto(ticketUrl);
  await expect(async () => {
    await agent.reload();
    const ask = agent.getByRole("button", { name: "Sugerir resposta" });
    if (await ask.isVisible()) await ask.click();
    await expect(agent.getByRole("region", { name: "Rascunho da IA" })).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 90_000 });
  const card = agent.getByRole("region", { name: "Rascunho da IA" });
  await expect(card.getByRole("link", { name: articleTitle })).toBeVisible();

  // 4. O solicitante nunca vê o rascunho; o técnico o publica como comentário
  await requester.reload();
  await expect(requester.getByText("Rascunho da IA")).toHaveCount(0);
  await card.getByRole("button", { name: "Publicar como comentário" }).click();
  await expect(agent.getByRole("region", { name: "Rascunho da IA" })).toHaveCount(0);
  await requester.reload();
  await expect(requester.getByText(/Com base nas fontes/)).toBeVisible();

  // 5. O técnico resolve informando a solução
  await agent.getByRole("button", { name: /Marcar como em andamento/i }).click();
  await expect(agent.getByText("Em andamento", { exact: true }).first()).toBeVisible();
  await agent.getByRole("button", { name: /Marcar como resolvido/i }).click();
  await agent.getByLabel("Solução").fill("Reiniciei o ponto de acesso e troquei o cabo de rede do andar.");
  await agent.getByRole("button", { name: "Resolver chamado" }).click();
  await expect(agent.getByText("Resolvido", { exact: true }).first()).toBeVisible();

  // 6. O solicitante vê a solução e confirma com 5 estrelas e comentário
  await requester.reload();
  const solution = requester.getByRole("region", { name: "Solução" });
  await expect(solution.getByText(/Reiniciei o ponto de acesso/)).toBeVisible();
  await requester.getByRole("radio", { name: "5 estrelas" }).click();
  await requester.getByLabel("Comentário (opcional)").fill("Atendimento rápido e claro.");
  await requester.getByRole("button", { name: "Confirmar fechamento" }).click();
  const rating = requester.getByRole("region", { name: "Avaliação do atendimento" });
  await expect(rating.getByLabel("Nota 5 de 5")).toBeVisible();
  await expect(rating.getByText("Atendimento rápido e claro.")).toBeVisible();

  // 7. O técnico vê a nota
  await agent.reload();
  await expect(agent.getByRole("region", { name: "Avaliação do atendimento" }).getByText("Atendimento rápido e claro.")).toBeVisible();

  await adminCtx.close();
  await requesterCtx.close();
  await agentCtx.close();
});
