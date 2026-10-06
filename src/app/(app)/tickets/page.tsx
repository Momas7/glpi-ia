import Link from "next/link";
import { ArrowDownUpIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { SlaBadge } from "@/components/SlaBadge";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge, StatusBadge } from "@/components/StatusBadges";
import { buttonVariants } from "@/components/ui/button";
import { STATUS_LABEL, formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { duplicateTicketIds, pendingTriageTicketIds } from "@/modules/ai";
import { loadCalendar, slaState } from "@/modules/sla";
import { countTicketsByStatus, listQuerySchema, listTickets, type TicketStatus } from "@/modules/tickets";

export const metadata = { title: "Chamados · Sentinela" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Cards do topo, à moda do GLPI: cor sólida por status, número grande.
const TILES: { status?: TicketStatus; label: string; className: string }[] = [
  { label: "Todos", className: "bg-amber-400 text-black" },
  { status: "NEW", label: "Novos", className: "bg-emerald-500 text-black" },
  { status: "OPEN", label: "Em atendimento", className: "bg-sky-500 text-black" },
  { status: "PENDING", label: "Pendentes", className: "bg-orange-400 text-black" },
  { status: "RESOLVED", label: "Solucionados", className: "bg-zinc-400 text-black" },
  { status: "CLOSED", label: "Fechados", className: "bg-zinc-800 text-zinc-200" },
];

const th = "px-3 py-2.5 text-left align-bottom text-[11px] font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase";
const td = "px-3 py-3 align-top";

/** Páginas exibidas na paginação: a atual, vizinhas, primeira e última (com reticências entre elas). */
function pageWindow(page: number, pages: number): (number | "…")[] {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

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
    order: first(raw.order) || undefined,
  });
  const query = parsed.success ? parsed.data : listQuerySchema.parse({});
  const [{ items, total, page, pageSize }, cal, counts] = await Promise.all([
    listTickets(user, query),
    loadCalendar(),
    countTicketsByStatus(user),
  ]);
  const [aiPending, duplicated] = await Promise.all([pendingTriageTicketIds(user, items), duplicateTicketIds(user, items)]);
  const now = new Date();
  const isStaff = user.role !== "REQUESTER";
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const order = query.order ?? (isStaff ? "due" : "recent");
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const href = (
    p: number,
    over: { scope?: string; sla?: string; status?: string; order?: string } = {},
  ) => {
    const v = { scope: query.scope, sla: query.sla, status: query.status, order: query.order, ...over };
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (v.status) sp.set("status", v.status);
    if (v.scope) sp.set("scope", v.scope);
    if (v.sla) sp.set("sla", v.sla);
    if (v.order) sp.set("order", v.order);
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
  const chipClass = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      on ? "bg-white/15 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Chamados</h1>

      <section aria-label="Resumo por status" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {TILES.map((t) => {
          const on = query.status === t.status;
          return (
            <Link
              key={t.label}
              href={href(1, { status: t.status })}
              aria-current={on ? "page" : undefined}
              className={`flex h-24 flex-col justify-between rounded-md p-3 transition-[filter,box-shadow] hover:brightness-110 ${t.className} ${
                on ? "ring-2 ring-white ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <span className="text-3xl leading-none font-light tabular-nums">
                {(t.status ? counts[t.status] : allCount).toLocaleString("pt-BR")}
              </span>
              <span className="text-sm opacity-80">{t.label}</span>
            </Link>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-md border border-white/10 bg-card">
        <div className="flex flex-col gap-3 border-b border-white/10 p-3 lg:flex-row lg:items-center">
          <nav aria-label="Filtros rápidos" className="flex flex-wrap items-center gap-1">
            {chips.map((c) => {
              const on = query.scope === c.scope && !query.sla;
              return (
                <Link key={c.label} href={href(1, { scope: c.scope, sla: undefined })} aria-current={on ? "page" : undefined} className={chipClass(on)}>
                  {c.label}
                </Link>
              );
            })}
            {isStaff && (
              <>
                <span aria-hidden className="mx-1 h-4 w-px bg-white/15" />
                {(
                  [
                    { label: "Vencendo", sla: "at_risk" },
                    { label: "Vencidos", sla: "breached" },
                  ] as const
                ).map((c) => (
                  <Link
                    key={c.sla}
                    href={href(1, { sla: c.sla })}
                    aria-current={query.sla === c.sla ? "page" : undefined}
                    className={chipClass(query.sla === c.sla)}
                  >
                    {c.label}
                  </Link>
                ))}
              </>
            )}
          </nav>

          <Link
            href={href(1, { order: order === "due" ? "recent" : "due" })}
            className="flex items-center gap-1.5 self-start rounded-md bg-orange-500/15 whitespace-nowrap px-2.5 py-1 text-xs font-medium text-orange-300 hover:bg-orange-500/25 lg:self-auto"
          >
            <ArrowDownUpIcon aria-hidden className="size-3.5" />
            Ordenado por {order === "due" ? "prazo" : "mais recentes"}
          </Link>

          <form method="get" className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {query.scope && <input type="hidden" name="scope" value={query.scope} />}
            {query.sla && <input type="hidden" name="sla" value={query.sla} />}
            {query.order && <input type="hidden" name="order" value={query.order} />}
            <select
              name="status"
              aria-label="Status"
              defaultValue={query.status ?? ""}
              className="h-8 rounded-md border border-white/10 bg-background px-2 text-xs"
            >
              <option value="">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <div className="flex">
              <input
                name="q"
                defaultValue={query.q}
                placeholder="Buscar no título…"
                aria-label="Pesquisar na lista"
                className="h-8 w-48 rounded-l-md border border-r-0 border-white/10 bg-background px-2.5 text-xs outline-none focus:border-white/25"
              />
              <button type="submit" aria-label="Filtrar" className="grid h-8 w-9 place-items-center rounded-r-md border border-white/10 bg-white/[0.06] hover:bg-white/10">
                <SearchIcon aria-hidden className="size-3.5" />
              </button>
            </div>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 bg-white/[0.02]">
              <tr>
                <th className={`${th} w-16`}>ID</th>
                <th className={th}>Título</th>
                <th className={th}>Status</th>
                <th className={th}>Prioridade</th>
                <th className={th}>Prazo</th>
                <th className={th}>Requerente</th>
                <th className={th}>Atribuído</th>
                <th className={th}>Equipe</th>
                <th className={th}>Categoria</th>
                <th className={th}>Abertura</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    Nenhum chamado encontrado.
                  </td>
                </tr>
              )}
              {items.map((t) => (
                <tr key={t.id} className="border-b border-white/[0.06] transition-colors odd:bg-white/[0.015] hover:bg-white/[0.05]">
                  <td className={`${td} text-muted-foreground tabular-nums whitespace-nowrap`}>{t.number}</td>
                  <td className={`${td} min-w-56`}>
                    <Link href={`/tickets/${t.id}`} className="font-medium hover:text-amber-300 hover:underline">
                      {t.title}
                    </Link>
                    {(duplicated.has(t.id) || aiPending.has(t.id)) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {duplicated.has(t.id) && (
                          <Badge variant="outline" className="border-amber-500/50 text-amber-300">
                            Possível duplicado
                          </Badge>
                        )}
                        {aiPending.has(t.id) && (
                          <Badge variant="outline" className="border-violet-500/50 text-violet-300">
                            IA sugeriu
                          </Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={td}>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className={td}>
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td className={td}>
                    <SlaBadge {...slaState(t, now, cal)} />
                  </td>
                  <td className={`${td} min-w-32`}>{t.requester.name}</td>
                  <td className={`${td} min-w-32 ${t.assignee ? "" : "text-muted-foreground"}`}>{t.assignee?.name ?? "—"}</td>
                  <td className={`${td} min-w-28`}>
                    {t.team ? <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-xs">{t.team.name}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={`${td} min-w-32 text-muted-foreground`}>{t.category?.name ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap text-muted-foreground tabular-nums`}>{formatDateTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 px-3 py-3 text-sm sm:flex-row">
          <span className="text-muted-foreground">
            {total === 0
              ? "Nenhuma linha"
              : `Exibindo ${(page - 1) * pageSize + 1} a ${Math.min(page * pageSize, total)} de ${total.toLocaleString("pt-BR")} linhas`}
          </span>
          {pages > 1 && (
            <nav aria-label="Paginação" className="flex items-center gap-1">
              {page > 1 && (
                <Link href={href(page - 1)} aria-label="Anterior" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                  <ChevronLeftIcon aria-hidden />
                </Link>
              )}
              {pageWindow(page, pages).map((p, i) =>
                p === "…" ? (
                  <span key={`gap-${i}`} className="px-1 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={href(p)}
                    aria-current={p === page ? "page" : undefined}
                    className={`grid h-8 min-w-8 place-items-center rounded-md px-2 tabular-nums ${
                      p === page ? "bg-white/15 font-semibold" : "text-muted-foreground hover:bg-white/5"
                    }`}
                  >
                    {p}
                  </Link>
                ),
              )}
              {page < pages && (
                <Link href={href(page + 1)} aria-label="Próxima" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                  <ChevronRightIcon aria-hidden />
                </Link>
              )}
            </nav>
          )}
        </div>
      </section>
    </div>
  );
}
