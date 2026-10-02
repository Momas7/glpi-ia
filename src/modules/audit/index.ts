import type { Prisma } from "@/generated/prisma/client";

export type AuditAction =
  | "user.invite"
  | "invite.revoke"
  | "user.role_change"
  | "user.deactivate"
  | "user.activate"
  | "team.create"
  | "team.rename"
  | "team.member_add"
  | "team.member_remove"
  | "category.create"
  | "category.update";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: "user" | "invite" | "team" | "category";
  targetId: string;
  data?: Record<string, unknown>;
}

/** Grava a ação administrativa na mesma transação da mudança. */
export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: { ...entry, data: (entry.data ?? {}) as Prisma.InputJsonValue },
  });
}
