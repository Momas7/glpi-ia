import { InviteForm } from "@/components/admin/InviteForm";
import { RevokeInviteButton, UserRowActions } from "@/components/admin/UserRowActions";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABEL, formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { listPendingInvites, listUsers } from "@/modules/admin";

export const metadata = { title: "Usuários · Administração" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q } = await searchParams;
  const [{ items, total }, invites] = await Promise.all([
    listUsers(user, { page: 1, pageSize: 100, q: q || undefined }),
    listPendingInvites(user),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Convidar pessoa</h2>
        <InviteForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Convites pendentes</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3">
                <span>{i.email}</span>
                <Badge variant="outline">{ROLE_LABEL[i.role]}</Badge>
                <span className="text-muted-foreground">expira em {formatDateTime(i.expiresAt)}</span>
                <RevokeInviteButton id={i.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Usuários ({total})</h2>
          <form method="get">
            <Input name="q" defaultValue={q} placeholder="Buscar por nome ou e-mail…" className="w-72" />
          </form>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Equipes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Papel e ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell className="text-muted-foreground">{u.teams.map((t) => t.name).join(", ") || "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{u.active ? "Ativo" : "Desativado"}</Badge>
                </TableCell>
                <TableCell>
                  <UserRowActions id={u.id} role={u.role} active={u.active} isSelf={u.id === user.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
