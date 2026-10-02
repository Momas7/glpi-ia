import { getDb } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { can, type SessionUser } from "@/modules/auth";
import { addComment } from "./comments";
import { createTicket } from "./service";

type ApiKeyRef = { id: string; name: string };
type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "P2002";
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Usuário ativo pelo e-mail (sem diferenciar maiúsculas), já no formato de sessão (com equipes). */
async function activeUserByEmail(email: string): Promise<SessionUser | null> {
  const user = await getDb().user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { teams: true } });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, teamIds: user.teams.map((t) => t.teamId) };
}

async function findByExternalRef(apiKeyId: string, externalRef: string) {
  return getDb().ticket.findUnique({ where: { apiKeyId_externalRef: { apiKeyId, externalRef } } });
}

/** Chamado aberto pelo n8n em nome do solicitante. `externalRef` repetido (ex.: Message-ID) devolve o existente. */
export async function createTicketFromApi(
  apiKey: ApiKeyRef,
  input: { requesterEmail: string; title: string; description: string; categoryName?: string; priority?: Priority; externalRef?: string },
): Promise<{ ticket: { id: string; number: number; url: string }; created: boolean }> {
  const requester = await activeUserByEmail(input.requesterEmail);
  if (!requester) throw new AppError(422, "requester_not_found");
  const shape = (t: { id: string; number: number }, created: boolean) => ({
    ticket: { id: t.id, number: t.number, url: `${appUrl()}/tickets/${t.id}` },
    created,
  });

  if (input.externalRef) {
    const existing = await findByExternalRef(apiKey.id, input.externalRef);
    if (existing) return shape(existing, false);
  }
  const category = input.categoryName
    ? await getDb().category.findFirst({ where: { parentId: null, name: { equals: input.categoryName.trim(), mode: "insensitive" } } })
    : null;

  try {
    const ticket = await createTicket(
      requester,
      { title: input.title, description: input.description, priority: input.priority, categoryId: category?.id },
      { source: "API", apiKeyId: apiKey.id, apiKeyName: apiKey.name, externalRef: input.externalRef },
    );
    return shape(ticket, true);
  } catch (err) {
    // Duas chamadas simultâneas com o mesmo externalRef: a perdedora devolve o chamado da vencedora.
    if (input.externalRef && isUniqueViolation(err)) {
      const existing = await findByExternalRef(apiKey.id, input.externalRef);
      if (existing) return shape(existing, false);
    }
    throw err;
  }
}

/** Comentário público enviado pelo n8n em nome de quem pode comentar no chamado. */
export async function addCommentFromApi(
  _apiKey: ApiKeyRef,
  ticketNumber: number,
  input: { authorEmail: string; body: string; externalRef?: string },
): Promise<{ comment: { id: string }; created: boolean }> {
  const ticket = await getDb().ticket.findUnique({ where: { number: ticketNumber } });
  if (!ticket) throw new NotFoundError("Chamado não encontrado.");
  const author = await activeUserByEmail(input.authorEmail);
  // Pela API (ex.: resposta de e-mail, cujo remetente pode ser forjado) só o solicitante comenta: um integrador
  // não pode publicar comentário público "assinado" por admin ou técnico.
  if (!author || author.id !== ticket.requesterId || !can(author, "comment:create", ticket)) {
    throw new AppError(403, "Pela API, só o solicitante do chamado pode comentar.");
  }

  const existing = () =>
    input.externalRef
      ? getDb().comment.findUnique({ where: { ticketId_externalRef: { ticketId: ticket.id, externalRef: input.externalRef } } })
      : Promise.resolve(null);
  const found = await existing();
  if (found) return { comment: { id: found.id }, created: false };

  try {
    const comment = await addComment(author, ticket.id, { body: input.body, internal: false }, { source: "API", externalRef: input.externalRef });
    return { comment: { id: comment.id }, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await existing();
      if (again) return { comment: { id: again.id }, created: false };
    }
    throw err;
  }
}
