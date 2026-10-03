import { z } from "zod";

export const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const typeEnum = z.enum(["INCIDENT", "REQUEST"]);
export const statusEnum = z.enum(["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"]);

export const createTicketSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10_000),
  type: typeEnum.optional(),
  priority: priorityEnum.optional(),
  categoryId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
});

const updatableFields = {
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10_000),
  type: typeEnum,
  priority: priorityEnum,
  categoryId: z.string().min(1).nullable(),
};

// Equipe e responsável não são campos editáveis: mudam só por assignTicket/takeTicket.
export const updateTicketSchema = z
  .object(updatableFields)
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar.");

/** Solução escrita ao marcar como Resolvido: alimenta a base de conhecimento. */
export const resolutionTextSchema = z.string().trim().min(10).max(4000);

/** Corpo do PATCH: campos editáveis, mudança de status e, ao resolver, a solução. */
export const patchTicketSchema = z
  .object({ ...updatableFields, status: statusEnum, resolution: resolutionTextSchema })
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar.");

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).default(20).transform((n) => Math.min(n, 100)),
  status: statusEnum.optional(),
  teamId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  // Filtros rápidos: atribuídos a mim, da minha equipe, abertos por mim.
  scope: z.enum(["assigned", "team", "mine"]).optional(),
  // SLA: "Vencendo" (marcado pelo job a cada 5 min) e "Vencidos" (pelo prazo gravado).
  sla: z.enum(["at_risk", "breached"]).optional(),
  // Ordem: por prazo de resolução (padrão da equipe) ou mais recentes (padrão do solicitante).
  order: z.enum(["due", "recent"]).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type ListTicketsQuery = Partial<z.input<typeof listQuerySchema>> & { page: number; pageSize: number };
export type PatchTicketInput = z.infer<typeof patchTicketSchema>;
export type TicketStatus = z.infer<typeof statusEnum>;

// Chamado nunca fica sem equipe pela atribuição (sumiria de todas as filas).
export const assignTicketSchema = z
  .object({
    teamId: z.string().min(1),
    assigneeId: z.string().min(1).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Informe a equipe e/ou o responsável.");

export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
