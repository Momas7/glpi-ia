import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";

export const APP_NAME = "Sistema de Chamados";

export interface NavItem {
  href: string;
  label: string;
}

/** Itens do menu lateral conforme o papel de quem está logado. */
export function buildNavItems(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { href: "/tickets", label: "Chamados" },
    { href: "/tickets/new", label: "Novo chamado" },
  ];
  if (can(user, "dashboard:view")) items.push({ href: "/dashboard", label: "Dashboard" });
  if (can(user, "admin:manage")) items.push({ href: "/admin", label: "Administração" });
  return items;
}
