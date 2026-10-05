"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/forms/LogoutButton";
import { APP_NAME, type NavItem } from "@/lib/nav";

/** O item ativo é o de href mais longo que combina com a página (assim "Novo chamado" não acende "Chamados"). */
function activeHref(items: NavItem[], pathname: string): string | null {
  const matches = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

function NavContent({ items, userName, roleLabel, onNavigate }: Props & { onNavigate?: () => void }) {
  const active = activeHref(items, usePathname());
  return (
    <div className="flex h-full flex-col gap-6">
      <Link href="/tickets" onClick={onNavigate} className="px-3 text-lg font-semibold tracking-tight">
        {APP_NAME}
      </Link>
      <nav aria-label="Principal" className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const isActive = item.href === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                isActive ? "bg-white/10 font-medium text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t border-white/10 pt-4">
        <p className="px-3 text-sm font-medium">{userName}</p>
        <p className="px-3 text-xs text-muted-foreground">{roleLabel}</p>
        <div className="px-1">
          <LogoutButton />
        </div>
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-white/10 bg-background p-4 md:block">
        <NavContent {...props} />
      </aside>

      <div className="md:hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="font-semibold">{APP_NAME}</span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="menu-mobile"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm"
          >
            {open ? "Fechar" : "Menu"}
          </button>
        </div>
        {open && (
          <div id="menu-mobile" className="border-b border-white/10 bg-background p-4">
            <NavContent {...props} onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>
    </>
  );
}
