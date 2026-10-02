import { createDb, type Db } from "../src/lib/db";

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
