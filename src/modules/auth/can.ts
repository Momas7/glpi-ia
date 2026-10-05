import type { SessionUser } from "./session";

export type TicketStatus = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";

export type Action =
  | "ticket:create"
  | "ticket:read"
  | "ticket:update"
  | "ticket:assign"
  | "ticket:close"
  | "comment:create"
  | "comment:read_internal"
  | "attachment:add"
  | "user:invite"
  | "user:manage"
  | "ticket:take"
  | "ticket:reopen"
  | "ticket:confirm"
  | "admin:manage"
  | "dashboard:view"
  | "ai:decide";

export interface TicketResource {
  requesterId?: string;
  teamId?: string | null;
  assigneeId?: string | null;
  status?: TicketStatus;
}

/** Ponto único de autorização. Função pura: não consulta o banco. */
export function can(user: SessionUser, action: Action, resource?: TicketResource): boolean {
  // Ações que pertencem ao solicitante do chamado: nem o ADMIN as executa em nome dele.
  if (action === "ticket:reopen" || action === "ticket:confirm") {
    return !!resource && resource.requesterId === user.id && resource.status === "RESOLVED";
  }
  if (user.role === "ADMIN") return true;

  switch (action) {
    case "ticket:create":
      return true;
    case "user:invite":
    case "user:manage":
    case "admin:manage":
      return false;
    case "dashboard:view":
      return user.role === "TEAM_LEAD";
    case "ticket:take":
      return isStaff(user) && inMyTeam(user, resource) && !resource?.assigneeId;
    case "ticket:read":
    case "comment:create":
    case "attachment:add":
      return canAccessTicket(user, resource);
    case "ticket:update":
    case "ai:decide":
    case "ticket:close":
    case "comment:read_internal":
      return isStaffFor(user, resource);
    case "ticket:assign":
      return user.role === "TEAM_LEAD" && inMyTeam(user, resource);
  }
}

function isStaff(user: SessionUser): boolean {
  return user.role === "AGENT" || user.role === "TEAM_LEAD";
}

/**
 * Direitos de técnico valem pela relação com o chamado (equipe ou responsável), não só pelo papel:
 * um técnico que apenas abriu um chamado para outra equipe é tratado como solicitante comum.
 */
function isStaffFor(user: SessionUser, resource?: TicketResource): boolean {
  return isStaff(user) && (inMyTeam(user, resource) || (!!resource && resource.assigneeId === user.id));
}

function inMyTeam(user: SessionUser, resource?: TicketResource): boolean {
  return !!resource?.teamId && user.teamIds.includes(resource.teamId);
}

function canAccessTicket(user: SessionUser, resource?: TicketResource): boolean {
  if (!resource) return false;
  if (resource.requesterId === user.id) return true;
  if (user.role === "REQUESTER") return false;
  return inMyTeam(user, resource) || resource.assigneeId === user.id;
}
