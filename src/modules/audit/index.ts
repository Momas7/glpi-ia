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
  | "category.update"
  | "apikey.create"
  | "apikey.revoke"
  | "sla.policy_update"
  | "sla.hours_update"
  | "holiday.create"
  | "holiday.delete"
  | "ai.suggestion_accept"
  | "ai.suggestion_edit"
  | "ai.suggestion_reject"
  | "team.ai_toggle"
  | "kb.create"
  | "kb.update"
  | "kb.publish"
  | "kb.unpublish"
  | "kb.delete"
  | "ai.reindex";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: "user" | "invite" | "team" | "category" | "apikey" | "sla" | "ticket" | "kb" | "ai";
  targetId: string;
  data?: Record<string, unknown>;
}

/** Grava a ação administrativa na mesma transação da mudança. */
export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: { ...entry, data: (entry.data ?? {}) as Prisma.InputJsonValue },
  });
}
