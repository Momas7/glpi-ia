export const STATUS_LABEL: Record<string, string> = {
  NEW: "Novo",
  OPEN: "Em andamento",
  PENDING: "Pendente",
  RESOLVED: "Resolvido",
  CLOSED: "Fechado",
};

export const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export const TYPE_LABEL: Record<string, string> = { INCIDENT: "Incidente", REQUEST: "Requisição" };

export const ROLE_LABEL: Record<string, string> = {
  REQUESTER: "Solicitante",
  AGENT: "Técnico",
  TEAM_LEAD: "Gestor de equipe",
  ADMIN: "Administrador",
};

// Sempre no fuso da empresa: o servidor pode estar em UTC.
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo",
});
export const formatDateTime = (d: Date | string) => dateTime.format(new Date(d));
