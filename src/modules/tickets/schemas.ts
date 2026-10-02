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

export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(1).max(10_000),
    type: typeEnum,
    priority: priorityEnum,
    categoryId: z.string().min(1).nullable(),
    teamId: z.string().min(1).nullable(),
    assigneeId: z.string().min(1).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar.");

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: statusEnum.optional(),
  teamId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type ListTicketsQuery = Partial<z.input<typeof listQuerySchema>> & { page: number; pageSize: number };
export type TicketStatus = z.infer<typeof statusEnum>;
