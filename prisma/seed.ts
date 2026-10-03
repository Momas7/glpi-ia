import { createDb, type Db } from "../src/lib/db";
import { hashPassword } from "../src/modules/auth/password";
import { nationalHolidays } from "../src/modules/sla/holidays";
import { addBusinessMinutes } from "../src/modules/sla/calendar";
import { invalidateCalendarCache, loadCalendar, slaOnCreate } from "../src/modules/sla/service";

// Dados 100% fictícios. Nada aqui vem de uma empresa real.
const TEAMS = ["Infraestrutura", "Suporte N1", "Sistemas"] as const;

const ROOT_CATEGORIES: { name: string; team: (typeof TEAMS)[number] }[] = [
  { name: "Hardware", team: "Infraestrutura" },
  { name: "Software", team: "Sistemas" },
  { name: "Rede", team: "Infraestrutura" },
  { name: "Acessos", team: "Suporte N1" },
];

// Soluções fictícias por categoria: o RAG da demonstração precisa de texto de resolução com cara de verdade.
const SEED_SOLUTIONS: Record<string, string[]> = {
  Hardware: [
    "Troquei o equipamento defeituoso por um do estoque e registrei o patrimônio novo.",
    "Limpei os contatos e reiniciei o serviço de impressão; a fila voltou a andar.",
    "Atualizei o driver do dispositivo e testei com o usuário no local.",
  ],
  Software: [
    "Reinstalei o aplicativo com a versão homologada e reaplicamos a licença do usuário.",
    "Limpei o cache e atualizei o programa para a última versão estável.",
    "Corrigi a configuração da conta de e-mail no perfil e conferi a sincronização.",
  ],
  Rede: [
    "Reiniciei o ponto de acesso do andar e conferi o sinal; a conexão estabilizou.",
    "Troquei o cabo de rede e reconfigurei a porta do switch para a VLAN correta.",
    "Renovei o endereço IP da estação e ajustei o DNS; a navegação voltou ao normal.",
  ],
  Acessos: [
    "Redefini a senha, confirmei a identidade do solicitante e liberei o acesso solicitado.",
    "Desbloqueei a conta no diretório e orientei sobre a troca de senha a cada 90 dias.",
    "Adicionei o usuário ao grupo de permissão da pasta compartilhada, com aprovação do gestor.",
  ],
};
const solutionFor = (category: string | undefined, n: number): string => {
  const list = SEED_SOLUTIONS[category ?? ""] ?? SEED_SOLUTIONS.Software;
  return list[n % list.length];
};

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

  await seedSla(db);
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

const HISTORY_COUNT = 180;
const HISTORY_SUBJECTS = [
  "Impressora travada", "Acesso ao sistema", "Troca de periférico", "Lentidão na rede", "Senha expirada",
  "Instalação de software", "Erro ao emitir relatório", "Wi-Fi instável", "Pedido de licença", "Falha no e-mail",
  "VPN não conecta", "Monitor sem imagem", "Permissão em pasta", "Atualização pendente", "Telefone sem sinal",
];

/** Gerador pseudoaleatório com semente fixa: o histórico fictício é sempre o mesmo para o mesmo índice. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ~180 chamados fictícios resolvidos nos últimos 6 meses (com ~80% dentro do prazo) para o dashboard ter o que
 * mostrar. Idempotente por título; os prazos vêm das mesmas funções de SLA do sistema.
 */
async function seedHistory(db: Db, people: { agentId: string; requesterId: string }): Promise<void> {
  const existing = new Set(
    (await db.ticket.findMany({ where: { title: { startsWith: "Histórico " } }, select: { title: true } })).map((t) => t.title),
  );
  if (existing.size >= HISTORY_COUNT) return;
  const cal = await loadCalendar(db);
  const policies = new Map((await db.slaPolicy.findMany()).map((p) => [p.priority, p]));
  const categories = await db.category.findMany({ where: { parentId: null } });
  const DAY = 86_400_000;
  const now = Date.now();
  const priorities = ["LOW", "LOW", "LOW", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL"] as const;

  for (let i = 0; i < HISTORY_COUNT; i++) {
    const title = `Histórico ${i + 1}: ${HISTORY_SUBJECTS[i % HISTORY_SUBJECTS.length]}`;
    if (existing.has(title)) continue;
    const r = rng(1000 + i);
    const priority = priorities[Math.floor(r() * priorities.length)];
    const policy = policies.get(priority);
    if (!policy) continue;
    const createdAt = new Date(now - (8 + r() * 172) * DAY); // entre 8 e 180 dias atrás: o prazo já passou
    const category = categories[Math.floor(r() * categories.length)];

    const late = r() < 0.2;
    const resolutionBM = Math.max(5, Math.round(policy.resolutionMinutes * (late ? 1.05 + r() * 0.55 : 0.2 + r() * 0.75)));
    const firstBM = Math.max(1, Math.min(resolutionBM, Math.round(policy.firstResponseMinutes * (0.1 + r() * 0.9))));
    const resolvedAt = addBusinessMinutes(createdAt, resolutionBM, cal);
    const firstRespondedAt = addBusinessMinutes(createdAt, firstBM, cal);
    const closed = r() < 0.7;

    await db.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          title,
          description: "Chamado fictício do histórico de demonstração.",
          priority,
          type: r() < 0.6 ? "INCIDENT" : "REQUEST",
          status: closed ? "CLOSED" : "RESOLVED",
          requesterId: people.requesterId,
          assigneeId: people.agentId,
          categoryId: category?.id,
          teamId: category?.defaultTeamId,
          resolution: solutionFor(category?.name, i),
          createdAt,
        },
      });
      await slaOnCreate(tx, ticket.id, createdAt);
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          resolvedAt,
          closedAt: closed ? new Date(resolvedAt.getTime() + DAY) : null,
          firstRespondedAt,
          firstResponseBusinessMinutes: firstBM,
          resolutionBusinessMinutes: resolutionBM,
          pausedAt: null,
        },
      });
    });
  }
}

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

  invalidateCalendarCache();
  const HOUR = 3600_000;
  for (const [index, [title, description, categoryName, priority, type, status]] of DEMO_TICKETS.entries()) {
    if (await db.ticket.findFirst({ where: { title, requesterId: requester.id } })) continue;
    const category = await db.category.findFirst({ where: { name: categoryName, parentId: null } });
    // Datas espalhadas no passado: os mais antigos ainda abertos aparecem vencidos na demonstração.
    const createdAt = new Date(Date.now() - index * 7 * HOUR);
    const ticket = await db.ticket.create({
      data: {
        createdAt,
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
        resolution: status === "RESOLVED" || status === "CLOSED" ? solutionFor(categoryName, index) : null,
        pausedAt: status === "PENDING" ? new Date(createdAt.getTime() + HOUR) : null,
      },
    });
    await db.$transaction((tx) => slaOnCreate(tx, ticket.id, createdAt));
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
  await seedHistory(db, { agentId: agent.id, requesterId: requester.id });
}

const SLA_POLICIES = [
  { priority: "CRITICAL", firstResponseMinutes: 60, resolutionMinutes: 240 },
  { priority: "HIGH", firstResponseMinutes: 120, resolutionMinutes: 480 },
  { priority: "MEDIUM", firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { priority: "LOW", firstResponseMinutes: 480, resolutionMinutes: 2400 },
] as const;

/** Política padrão, expediente seg–sex 8h–18h e feriados nacionais do ano corrente e dos 2 seguintes. */
async function seedSla(db: Db): Promise<void> {
  for (const p of SLA_POLICIES) {
    await db.slaPolicy.upsert({ where: { priority: p.priority }, update: {}, create: p });
  }
  for (const weekday of [1, 2, 3, 4, 5]) {
    await db.businessHours.upsert({ where: { weekday }, update: {}, create: { weekday, startMinute: 480, endMinute: 1080 } });
  }
  const year = new Date().getFullYear();
  for (const y of [year, year + 1, year + 2]) {
    for (const h of nationalHolidays(y)) {
      const date = new Date(`${h.date}T00:00:00Z`);
      await db.holiday.upsert({ where: { date }, update: {}, create: { date, name: h.name } });
    }
  }
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
