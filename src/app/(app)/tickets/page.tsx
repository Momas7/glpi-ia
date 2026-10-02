import Link from "next/link";
import { PriorityBadge, StatusBadge } from "@/components/StatusBadges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_LABEL, formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { listQuerySchema, listTickets } from "@/modules/tickets";

export const metadata = { title: "Chamados · Chamados IA" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TicketsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const raw = await searchParams;
  const parsed = listQuerySchema.safeParse({
    page: first(raw.page),
    pageSize: first(raw.pageSize),
    status: first(raw.status) || undefined,
    q: first(raw.q) || undefined,
  });
  const query = parsed.success ? parsed.data : listQuerySchema.parse({});
  const { items, total, page, pageSize } = await listTickets(user, query);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (query.status) sp.set("status", query.status);
    sp.set("page", String(p));
    return `/tickets?${sp}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Chamados</h1>
        <Link href="/tickets/new" className={buttonVariants()}>
          Novo chamado
        </Link>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={query.q} placeholder="Buscar no título…" className="max-w-xs" />
        <select
          name="status"
          defaultValue={query.status ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Título</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Prioridade</TableHead>
            <TableHead>Solicitante</TableHead>
            <TableHead>Criado em</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                Nenhum chamado encontrado.
              </TableCell>
            </TableRow>
          )}
          {items.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="text-muted-foreground">{t.number}</TableCell>
              <TableCell>
                <Link href={`/tickets/${t.id}`} className="font-medium hover:underline">
                  {t.title}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={t.status} />
              </TableCell>
              <TableCell>
                <PriorityBadge priority={t.priority} />
              </TableCell>
              <TableCell>{t.requester.name}</TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(t.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} chamado(s) · página {page} de {pages}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={href(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Anterior
            </Link>
          )}
          {page < pages && (
            <Link href={href(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Próxima
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
