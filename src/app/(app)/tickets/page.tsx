import Link from "next/link";
import { SlaBadge } from "@/components/SlaBadge";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge, StatusBadge } from "@/components/StatusBadges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_LABEL, formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { duplicateTicketIds, pendingTriageTicketIds } from "@/modules/ai";
import { loadCalendar, slaState } from "@/modules/sla";
import { listQuerySchema, listTickets } from "@/modules/tickets";

export const metadata = { title: "Chamados · Sentinela" };

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
    scope: first(raw.scope) || undefined,
    sla: first(raw.sla) || undefined,
  });
  const query = parsed.success ? parsed.data : listQuerySchema.parse({});
  const [{ items, total, page, pageSize }, cal] = await Promise.all([listTickets(user, query), loadCalendar()]);
  const [aiPending, duplicated] = await Promise.all([pendingTriageTicketIds(user, items), duplicateTicketIds(user, items)]);
  const now = new Date();
  const isStaff = user.role !== "REQUESTER";
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const href = (p: number, scope: string | undefined = query.scope, sla: string | undefined = query.sla) => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (query.status) sp.set("status", query.status);
    if (scope) sp.set("scope", scope);
    if (sla) sp.set("sla", sla);
    sp.set("page", String(p));
    return `/tickets?${sp}`;
  };
  const chips: { label: string; scope?: "assigned" | "team" | "mine" }[] =
    user.role === "REQUESTER"
      ? [{ label: "Todos" }, { label: "Abertos por mim", scope: "mine" }]
      : [
          { label: "Todos" },
          { label: "Atribuídos a mim", scope: "assigned" },
          { label: "Minha equipe", scope: "team" },
          { label: "Abertos por mim", scope: "mine" },
        ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Chamados</h1>
        <Link href="/tickets/new" className={buttonVariants()}>
          Novo chamado
        </Link>
      </div>

      <nav aria-label="Filtros rápidos" className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={href(1, c.scope, undefined)}
            aria-current={query.scope === c.scope && !query.sla ? "page" : undefined}
            className={buttonVariants({ size: "sm", variant: query.scope === c.scope && !query.sla ? "secondary" : "outline" })}
          >
            {c.label}
          </Link>
        ))}
        {isStaff &&
          (
            [
              { label: "Vencendo", sla: "at_risk" },
              { label: "Vencidos", sla: "breached" },
            ] as const
          ).map((c) => (
            <Link
              key={c.sla}
              href={href(1, query.scope, c.sla)}
              aria-current={query.sla === c.sla ? "page" : undefined}
              className={buttonVariants({ size: "sm", variant: query.sla === c.sla ? "secondary" : "outline" })}
            >
              {c.label}
            </Link>
          ))}
      </nav>

      <form method="get" className="flex flex-wrap gap-2">
        {query.scope && <input type="hidden" name="scope" value={query.scope} />}
        {query.sla && <input type="hidden" name="sla" value={query.sla} />}
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
            <TableHead>Prazo</TableHead>
            <TableHead>Solicitante</TableHead>
            <TableHead>Criado em</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
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
                {duplicated.has(t.id) && (
                  <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-300">
                    Possível duplicado
                  </Badge>
                )}
                {aiPending.has(t.id) && (
                  <Badge variant="outline" className="ml-2 border-violet-500/50 text-violet-300">
                    IA sugeriu
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={t.status} />
              </TableCell>
              <TableCell>
                <PriorityBadge priority={t.priority} />
              </TableCell>
              <TableCell>
                <SlaBadge {...slaState(t, now, cal)} />
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
