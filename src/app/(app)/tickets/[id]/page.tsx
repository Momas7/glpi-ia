import { notFound } from "next/navigation";
import { AttachmentForm } from "@/components/forms/AttachmentForm";
import { CommentForm } from "@/components/forms/CommentForm";
import { StatusControl } from "@/components/forms/StatusControl";
import { TicketActions } from "@/components/forms/TicketActions";
import { SafeText } from "@/components/SafeText";
import { PriorityBadge, StatusBadge } from "@/components/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { TYPE_LABEL, formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { can } from "@/modules/auth";
import { TRANSITIONS, getComments, getTicket, listAssignmentOptions, listAttachments } from "@/modules/tickets";

export const metadata = { title: "Chamado · Chamados IA" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const ticket = await getTicket(user, id);
  if (!ticket) notFound();

  const [comments, attachments] = await Promise.all([getComments(user, id), listAttachments(user, id)]);
  const canChange = can(user, "ticket:update", ticket);
  const canAssign = can(user, "ticket:assign", ticket);
  const assignmentTeams = canAssign ? await listAssignmentOptions() : [];
  const next = canChange
    ? TRANSITIONS[ticket.status].filter((s) => s !== "CLOSED" || can(user, "ticket:close", ticket))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Chamado #{ticket.number}</p>
        <h1 className="text-2xl font-semibold">{ticket.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <Badge variant="outline">{TYPE_LABEL[ticket.type]}</Badge>
        </div>
      </div>

      <StatusControl ticketId={ticket.id} next={next} />

      <TicketActions
        ticketId={ticket.id}
        // Assumir exige ser membro da equipe do chamado (o serviço valida); só oferece a quem é.
        canTake={can(user, "ticket:take", ticket) && !!ticket.teamId && user.teamIds.includes(ticket.teamId)}
        canReopen={can(user, "ticket:reopen", ticket)}
        canAssign={canAssign}
        teams={assignmentTeams}
        current={{ teamId: ticket.teamId, assigneeId: ticket.assigneeId }}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-white/10 p-4">
            <SafeText value={ticket.description} className="prose-sm space-y-2" />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-medium">Comentários</h2>
            {comments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
            {comments.map((c) => (
              <article
                key={c.id}
                className={`rounded-lg border p-3 ${c.internal ? "border-amber-500/40 bg-amber-500/5" : "border-white/10"}`}
              >
                <header className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <strong className="text-foreground">{c.author.name}</strong>
                  <span>{formatDateTime(c.createdAt)}</span>
                  {c.internal && <Badge variant="outline">Nota interna</Badge>}
                </header>
                <SafeText value={c.body} className="space-y-2 text-sm" />
              </article>
            ))}
            {can(user, "comment:create", ticket) && (
              <CommentForm ticketId={ticket.id} canInternal={can(user, "comment:read_internal", ticket)} />
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-5 text-sm">
          <dl className="flex flex-col gap-3">
            <Meta label="Solicitante" value={ticket.requester.name} />
            <Meta label="Responsável" value={ticket.assignee?.name ?? "—"} />
            <Meta label="Equipe" value={ticket.team?.name ?? "—"} />
            <Meta label="Categoria" value={ticket.category?.name ?? "—"} />
            <Meta label="Criado em" value={formatDateTime(ticket.createdAt)} />
            {ticket.resolvedAt && <Meta label="Resolvido em" value={formatDateTime(ticket.resolvedAt)} />}
          </dl>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Anexos</h2>
            {attachments.length === 0 && <p className="text-muted-foreground">Nenhum anexo.</p>}
            <ul className="flex flex-col gap-1">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={`/api/tickets/${ticket.id}/attachments/${a.id}`}
                    className="underline underline-offset-4"
                    download
                  >
                    {a.filename}
                  </a>{" "}
                  <span className="text-xs text-muted-foreground">({Math.ceil(a.size / 1024)} KB)</span>
                </li>
              ))}
            </ul>
            {can(user, "attachment:add", ticket) && <AttachmentForm ticketId={ticket.id} />}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
