import { createDb, type Db } from "../src/lib/db";
import { hashPassword } from "../src/modules/auth/password";

// Dados 100% fictícios. Nada aqui vem de uma empresa real.
const TEAMS = ["Infraestrutura", "Suporte N1", "Sistemas"] as const;

const ROOT_CATEGORIES: { name: string; team: (typeof TEAMS)[number] }[] = [
  { name: "Hardware", team: "Infraestrutura" },
  { name: "Software", team: "Sistemas" },
  { name: "Rede", team: "Infraestrutura" },
  { name: "Acessos", team: "Suporte N1" },
];

/** Idempotente. Raízes usam findFirst porque NULL em parentId não é único no Postgres. */
export async function seed(db: Db): Promise<void> {
  const teamIds = new Map<string, string>();
  for (const name of TEAMS) {
    const team = await db.team.upsert({ where: { name }, update: {}, create: { name } });
    teamIds.set(name, team.id);
  }

  for (const { name, team } of ROOT_CATEGORIES) {
    const defaultTeamId = teamIds.get(team)!;
    const existing = await db.category.findFirst({ where: { name, parentId: null } });
    if (existing) {
      await db.category.update({ where: { id: existing.id }, data: { defaultTeamId } });
    } else {
      await db.category.create({ data: { name, defaultTeamId } });
    }
  }

  await seedDemo(db, teamIds);
}

type Status = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// [título, descrição, categoria, prioridade, tipo, status]
const DEMO_TICKETS: [string, string, string, Priority, "INCIDENT" | "REQUEST", Status][] = [
  ["Impressora do 2º andar não imprime", "A fila trava e nada sai desde cedo.", "Hardware", "MEDIUM", "INCIDENT", "OPEN"],
  ["Troca de teclado", "Teclado com teclas falhando.", "Hardware", "LOW", "REQUEST", "NEW"],
  ["Monitor piscando", "Tela pisca a cada poucos segundos.", "Hardware", "MEDIUM", "INCIDENT", "PENDING"],
  ["Notebook não liga", "Após queda de energia o notebook não dá sinal de vida.", "Hardware", "HIGH", "INCIDENT", "OPEN"],
  ["Mouse sem fio sem resposta", "Já troquei a pilha.", "Hardware", "LOW", "INCIDENT", "RESOLVED"],
  ["Instalar planilha de orçamento", "Preciso do software de planilhas no meu computador.", "Software", "LOW", "REQUEST", "NEW"],
  ["Sistema de ponto fora do ar", "Ninguém consegue registrar entrada.", "Software", "CRITICAL", "INCIDENT", "OPEN"],
  ["Erro ao exportar relatório em PDF", "Aparece mensagem de erro inesperado.", "Software", "MEDIUM", "INCIDENT", "OPEN"],
  ["Atualização do antivírus pendente", "Aviso de atualização há três dias.", "Software", "LOW", "REQUEST", "RESOLVED"],
  ["Lentidão no sistema financeiro", "Telas demoram mais de um minuto para abrir.", "Software", "HIGH", "INCIDENT", "OPEN"],
  ["Licença do editor de imagens expirou", "Pede nova chave ao abrir.", "Software", "MEDIUM", "REQUEST", "PENDING"],
  ["Sem internet na sala de reuniões", "O Wi-Fi não conecta.", "Rede", "HIGH", "INCIDENT", "OPEN"],
  ["Ponto de rede novo na mesa 14", "Mudança de layout, preciso de um ponto.", "Rede", "LOW", "REQUEST", "NEW"],
  ["VPN cai a cada dez minutos", "Trabalho remoto instável.", "Rede", "HIGH", "INCIDENT", "PENDING"],
  ["Wi-Fi visitantes sem senha", "A rede de visitantes pede senha que ninguém conhece.", "Rede", "LOW", "REQUEST", "RESOLVED"],
  ["Switch do andar térreo reiniciando", "Quedas rápidas de conexão ao longo do dia.", "Rede", "CRITICAL", "INCIDENT", "OPEN"],
  ["Esqueci minha senha do e-mail", "Preciso redefinir o acesso.", "Acessos", "MEDIUM", "REQUEST", "RESOLVED"],
  ["Acesso à pasta do financeiro", "Preciso de leitura na pasta compartilhada.", "Acessos", "MEDIUM", "REQUEST", "OPEN"],
  ["Conta bloqueada após troca de senha", "Não consigo entrar desde ontem.", "Acessos", "HIGH", "INCIDENT", "OPEN"],
  ["Novo colaborador: criar contas", "Início na segunda-feira, precisa de e-mail e sistema.", "Acessos", "MEDIUM", "REQUEST", "NEW"],
  ["Remover acesso de ex-colaborador", "Desligamento na sexta.", "Acessos", "HIGH", "REQUEST", "CLOSED"],
  ["Cabo HDMI da sala de treinamento", "Cabo com mau contato.", "Hardware", "LOW", "REQUEST", "CLOSED"],
  ["Scanner não reconhecido", "O computador não detecta o scanner USB.", "Hardware", "MEDIUM", "INCIDENT", "OPEN"],
  ["Pedido de segundo monitor", "Para facilitar o trabalho com planilhas.", "Hardware", "LOW", "REQUEST", "PENDING"],
  ["E-mail não sincroniza no celular", "Parou de receber mensagens novas.", "Software", "MEDIUM", "INCIDENT", "RESOLVED"],
  ["Teams sem áudio", "Ninguém me escuta nas chamadas.", "Software", "MEDIUM", "INCIDENT", "RESOLVED"],
  ["Pasta de rede sumiu", "A unidade Z: não aparece mais.", "Rede", "HIGH", "INCIDENT", "OPEN"],
  ["Acesso ao sistema de compras", "Perfil de aprovador para o gerente.", "Acessos", "MEDIUM", "REQUEST", "CLOSED"],
  ["Telefone IP sem tom de discagem", "O ramal 214 está mudo.", "Rede", "MEDIUM", "INCIDENT", "OPEN"],
  ["Instalação de leitor de PDF", "Preciso editar documentos PDF.", "Software", "LOW", "REQUEST", "NEW"],
];

/** Usuários e chamados demo. Só roda com SEED_DEMO_PASSWORD definida (nunca com senha no código). */
async function seedDemo(db: Db, teamIds: Map<string, string>): Promise<void> {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) return;
  const passwordHash = await hashPassword(password);

  const upsertUser = (name: string, email: string, role: "ADMIN" | "AGENT" | "REQUESTER") =>
    db.user.upsert({
      where: { email },
      update: {},
      create: { name, email, role, passwordHash },
    });
  const admin = await upsertUser("Admin Demo", "admin@demo.test", "ADMIN");
  const agent = await upsertUser("Agente Demo", "agente@demo.test", "AGENT");
  const requester = await upsertUser("Solicitante Demo", "solicitante@demo.test", "REQUESTER");

  for (const name of ["Suporte N1", "Infraestrutura"]) {
    await db.teamMember.upsert({
      where: { userId_teamId: { userId: agent.id, teamId: teamIds.get(name)! } },
      update: {},
      create: { userId: agent.id, teamId: teamIds.get(name)! },
    });
  }

  for (const [title, description, categoryName, priority, type, status] of DEMO_TICKETS) {
    if (await db.ticket.findFirst({ where: { title, requesterId: requester.id } })) continue;
    const category = await db.category.findFirst({ where: { name: categoryName, parentId: null } });
    const ticket = await db.ticket.create({
      data: {
        title,
        description,
        priority,
        type,
        status,
        requesterId: requester.id,
        categoryId: category?.id,
        teamId: category?.defaultTeamId,
        assigneeId: status === "NEW" ? null : agent.id,
        resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date() : null,
        closedAt: status === "CLOSED" ? new Date() : null,
      },
    });
    await db.ticketEvent.create({
      data: { ticketId: ticket.id, actorId: requester.id, type: "CREATED", data: { number: ticket.number } },
    });
    if (status !== "NEW") {
      await db.comment.create({
        data: { ticketId: ticket.id, authorId: agent.id, body: "Recebi o chamado e já estou analisando.", internal: false },
      });
    }
  }
  void admin;
}

async function main() {
  const db = createDb(process.env.DATABASE_URL ?? "");
  try {
    await seed(db);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
