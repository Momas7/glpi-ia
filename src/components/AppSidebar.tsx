"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpenIcon,
  CirclePlusIcon,
  LayoutDashboardIcon,
  MenuIcon,
  ShieldCheckIcon,
  SirenIcon,
  TicketIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "@/components/forms/LogoutButton";
import { APP_NAME, type NavItem } from "@/lib/nav";

const ICON: Record<string, LucideIcon> = {
  "/tickets": TicketIcon,
  "/tickets/new": CirclePlusIcon,
  "/incidentes": SirenIcon,
  "/kb": BookOpenIcon,
  "/dashboard": LayoutDashboardIcon,
  "/admin": ShieldCheckIcon,
};

/** O item ativo é o de href mais longo que combina com a página (assim "Novo chamado" não acende "Chamados"). */
function activeHref(items: NavItem[], pathname: string): string | null {
  const matches = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** Agrupa preservando a ordem em que cada grupo aparece pela primeira vez. */
function groupItems(items: NavItem[]): [string, NavItem[]][] {
  const groups = new Map<string, NavItem[]>();
  for (const i of items) {
    const key = i.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups];
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="grid size-8 place-items-center rounded-md bg-amber-400 text-sm font-black text-black">
        S
      </span>
      <span className="text-lg font-bold tracking-tight">{APP_NAME}</span>
    </span>
  );
}

function NavContent({ items, userName, roleLabel, onNavigate }: Props & { onNavigate?: () => void }) {
  const active = activeHref(items, usePathname());
  return (
    <div className="flex h-full flex-col">
      <Link href="/tickets" onClick={onNavigate} className="px-5 py-5">
        <Logo />
      </Link>
      <nav aria-label="Principal" className="flex flex-1 flex-col gap-4 overflow-y-auto py-2">
        {groupItems(items).map(([group, list]) => (
          <div key={group} className="flex flex-col">
            {group && (
              <p className="px-5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{group}</p>
            )}
            {list.map((item) => {
              const isActive = item.href === active;
              const Icon = ICON[item.href];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 border-l-[3px] px-5 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-amber-400 bg-white/[0.07] font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  }`}
                >
                  {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">
          {userName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
        </div>
        <LogoutButton />
      </div>
    </div>
  );
}

interface Props {
  items: NavItem[];
  userName: string;
  roleLabel: string;
}

/** Menu lateral fixo no desktop; no celular, barra no topo com menu recolhível. */
export function AppSidebar(props: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-white/10 bg-sidebar md:block">
        <NavContent {...props} />
      </aside>

      <div className="bg-sidebar md:hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <Logo />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="menu-mobile"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-white/10 p-2"
          >
            {open ? <XIcon aria-hidden className="size-4" /> : <MenuIcon aria-hidden className="size-4" />}
          </button>
        </div>
        {open && (
          <div id="menu-mobile" className="border-b border-white/10">
            <NavContent {...props} onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>
    </>
  );
}
