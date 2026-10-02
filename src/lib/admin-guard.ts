import { notFound } from "next/navigation";
import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";

/** Páginas /admin: para quem não é ADMIN a área simplesmente não existe (404). */
export function assertAdminPage(user: SessionUser): void {
  if (!can(user, "admin:manage")) notFound();
}
