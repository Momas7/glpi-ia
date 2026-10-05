import { notFound } from "next/navigation";
import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";

/** Dashboard: para quem não é gestor de equipe nem admin a página simplesmente não existe (404). */
export function assertDashboardPage(user: SessionUser): void {
  if (!can(user, "dashboard:view")) notFound();
}
