import { CategoryDefaultTeam, CreateCategoryForm } from "@/components/admin/CategoryForm";
import { CreateTeamForm, TeamMembers } from "@/components/admin/TeamMembers";
import { requireUser } from "@/lib/server-session";
import { listCategories, listTeams, listUsers } from "@/modules/admin";

export const metadata = { title: "Equipes e categorias · Administração" };

export default async function TeamsPage() {
  const user = await requireUser();
  const [teams, categories, users] = await Promise.all([
    listTeams(user),
    listCategories(user),
    listUsers(user, { page: 1, pageSize: 100 }),
  ]);
  const staff = users.items
    .filter((u) => u.active && u.role !== "REQUESTER")
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));
  const teamOptions = teams.map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Equipes</h2>
        <CreateTeamForm />
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((t) => (
            <TeamMembers key={t.id} team={t} staff={staff} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Categorias</h2>
        <p className="text-sm text-muted-foreground">
          A equipe padrão recebe os chamados abertos naquela categoria.
        </p>
        <CreateCategoryForm teams={teamOptions} />
        <ul className="flex flex-col gap-2 text-sm">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3">
              <span className="w-40 font-medium">{c.name}</span>
              <CategoryDefaultTeam id={c.id} defaultTeamId={c.defaultTeam?.id ?? null} teams={teamOptions} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
