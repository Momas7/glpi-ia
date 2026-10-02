import type { SessionUser } from "./session";

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
  | "user:manage";

export interface TicketResource {
  requesterId?: string;
  teamId?: string | null;
  assigneeId?: string | null;
}

/** Ponto único de autorização. Função pura: não consulta o banco. */
export function can(user: SessionUser, action: Action, resource?: TicketResource): boolean {
  if (user.role === "ADMIN") return true;

  switch (action) {
    case "ticket:create":
      return true;
    case "user:invite":
    case "user:manage":
      return false;
    case "ticket:read":
    case "comment:create":
    case "attachment:add":
      return canAccessTicket(user, resource);
    case "ticket:update":
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
