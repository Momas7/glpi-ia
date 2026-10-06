"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon, HouseIcon, PlusIcon, SearchIcon } from "lucide-react";

const SECTION: Record<string, { label: string; href: string; parent?: string }> = {
  tickets: { label: "Chamados", href: "/tickets", parent: "Assistência" },
  incidentes: { label: "Incidentes", href: "/incidentes", parent: "Assistência" },
  kb: { label: "Base de conhecimento", href: "/kb", parent: "Conhecimento" },
  dashboard: { label: "Dashboard", href: "/dashboard", parent: "Gestão" },
  admin: { label: "Administração", href: "/admin", parent: "Gestão" },
};

const SUB: Record<string, string> = {
  new: "Novo",
  edit: "Editar",
  equipes: "Equipes",
  usuarios: "Usuários",
  ia: "IA",
  integracoes: "Integrações",
  saude: "Saúde do sistema",
  sla: "SLA",
};

function crumbs(pathname: string): { label: string; href?: string }[] {
  const [first, ...rest] = pathname.split("/").filter(Boolean);
  const section = first ? SECTION[first] : undefined;
  if (!section) return [];
  const out: { label: string; href?: string }[] = [];
  if (section.parent) out.push({ label: section.parent });
  out.push({ label: section.label, href: section.href });
  const last = rest.at(-1);
  if (last) out.push({ label: SUB[last] ?? (first === "tickets" ? "Chamado" : first === "kb" ? "Artigo" : last) });
  return out;
}

/** Barra do topo: trilha da página, atalho para abrir chamado e busca por título. */
export function AppTopbar() {
  const trail = crumbs(usePathname());
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-white/10 bg-background/90 px-4 backdrop-blur md:px-6">
      <nav aria-label="Trilha" className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground sm:flex">
        <HouseIcon aria-hidden className="size-4 shrink-0" />
        {trail.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 opacity-50" />
            {c.href && i < trail.length - 1 ? (
              <Link href={c.href} className="truncate hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className={`truncate ${i === trail.length - 1 ? "text-foreground" : ""}`}>{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <Link
        href="/tickets/new"
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-300"
      >
        <PlusIcon aria-hidden className="size-3.5" />
        Adicionar
      </Link>
      <form method="get" action="/tickets" role="search" className="ml-auto flex w-full max-w-xs items-center">
        <label htmlFor="busca-global" className="sr-only">
          Pesquisar chamados
        </label>
        <input
          id="busca-global"
          name="q"
          placeholder="Pesquisar…"
          className="h-9 w-full rounded-l-md border border-r-0 border-white/10 bg-white/[0.03] px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-white/25"
        />
        <button
          type="submit"
          aria-label="Pesquisar"
          className="grid h-9 w-10 place-items-center rounded-r-md border border-white/10 bg-white/[0.06] hover:bg-white/10"
        >
          <SearchIcon aria-hidden className="size-4" />
        </button>
      </form>
    </header>
  );
}
