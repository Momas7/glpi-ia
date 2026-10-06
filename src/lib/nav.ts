import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";

export const APP_NAME = "Sentinela";

export type NavGroup = "Assistência" | "Conhecimento" | "Gestão";

export interface NavItem {
  href: string;
  label: string;
  /** Seção do menu lateral (sem grupo: aparece no topo). */
  group?: NavGroup;
}

/** Itens do menu lateral conforme o papel de quem está logado. */
export function buildNavItems(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { href: "/tickets", label: "Chamados", group: "Assistência" },
    { href: "/tickets/new", label: "Novo chamado", group: "Assistência" },
  ];
  if (can(user, "kb:read")) items.push({ href: "/kb", label: "Base de conhecimento", group: "Conhecimento" });
  if (can(user, "dashboard:view")) items.push({ href: "/dashboard", label: "Dashboard", group: "Gestão" });
  if (can(user, "incident:view")) items.push({ href: "/incidentes", label: "Incidentes", group: "Assistência" });
  if (can(user, "admin:manage")) items.push({ href: "/admin", label: "Administração", group: "Gestão" });
  return items;
}
