import { notFound } from "next/navigation";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  MessageSquareIcon,
  PaperclipIcon,
  StarIcon,
  UserIcon,
  UsersIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { AiDraftCard } from "@/components/AiDraftCard";
import { AiDuplicatesCard } from "@/components/AiDuplicatesCard";
import { IncidentNotice } from "@/components/IncidentNotice";
import { AiSummaryCard } from "@/components/AiSummaryCard";
import { AiSuggestionCard } from "@/components/AiSuggestionCard";
import { LateRating } from "@/components/RatingBox";
import { AttachmentForm } from "@/components/forms/AttachmentForm";
import { CommentForm } from "@/components/forms/CommentForm";
import { StatusControl } from "@/components/forms/StatusControl";
import { TicketActions } from "@/components/forms/TicketActions";
import { SafeText } from "@/components/SafeText";
import { SlaBadge } from "@/components/SlaBadge";
import { PriorityBadge, StatusBadge, StatusDot } from "@/components/StatusBadges";
import { Badge } from "@/components/ui/badge";
import { TYPE_LABEL, formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { getDraftView, getDuplicatesView, getIncidentNotice, getPendingTriage, getSummaryView } from "@/modules/ai";
import { can } from "@/modules/auth";
import { loadCalendar, slaState } from "@/modules/sla";
import { RATING_WINDOW_DAYS, TRANSITIONS, getComments, getRating, getTicket, listAssignmentOptions, listAttachments } from "@/modules/tickets";

export const metadata = { title: "Chamado · Sentinela" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const ticket = await getTicket(user, id);
  if (!ticket) notFound();

  const [comments, attachments, aiSuggestion, rating, draftView, duplicates, incidentNotice, summaryView] = await Promise.all([
    getComments(user, id),
    listAttachments(user, id),
    getPendingTriage(user, ticket),
    getRating(user, id),
    getDraftView(user, ticket),
    getDuplicatesView(user, ticket),
    getIncidentNotice(user, ticket),
    getSummaryView(user, ticket),
  ]);
  const withinRatingWindow =
    ticket.status === "CLOSED" && (!ticket.closedAt || new Date().getTime() <= ticket.closedAt.getTime() + RATING_WINDOW_DAYS * 86_400_000);
  const canRateLate = can(user, "ticket:rate", ticket) && ticket.status === "CLOSED" && withinRatingWindow && !rating;
  const sla = slaState(ticket, new Date(), await loadCalendar());
  const canChange = can(user, "ticket:update", ticket);
  const canAssign = can(user, "ticket:assign", ticket);
  const assignmentTeams = canAssign ? await listAssignmentOptions() : [];
  const next = canChange
    ? TRANSITIONS[ticket.status].filter((s) => s !== "CLOSED" || can(user, "ticket:close", ticket))
    : [];

  const visibleComments = comments.filter((c) => c.source !== "AI_DRAFT");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-white/10 bg-card px-4 py-3">
        <StatusDot status={ticket.status} className="size-3.5" />
        <h1 className="text-lg font-semibold">{ticket.title}</h1>
        <span className="text-sm text-muted-foreground tabular-nums">(#{ticket.number})</span>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <SlaBadge {...sla} />
        </div>
      </div>

      {incidentNotice && <IncidentNotice notice={incidentNotice} />}
      {aiSuggestion && <AiSuggestionCard ticketId={ticket.id} suggestion={aiSuggestion} />}
      {duplicates && <AiDuplicatesCard ticketId={ticket.id} suggestion={duplicates} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-4">
          <TimelineItem
            author={ticket.requester.name}
            meta={`Criado em ${formatDateTime(ticket.createdAt)}`}
            className="border-emerald-500/30 bg-emerald-500/[0.06]"
          >
            <p className="mb-3 border-b border-white/10 pb-3 font-medium">{ticket.title}</p>
            <SafeText value={ticket.description} className="prose-sm space-y-2" />
          </TimelineItem>

          {visibleComments.map((c) => (
            <TimelineItem
              key={c.id}
              author={c.author.name}
              meta={formatDateTime(c.createdAt)}
              tag={c.internal ? "Nota interna" : undefined}
              className={c.internal ? "border-amber-500/40 bg-amber-500/[0.06]" : "border-white/10 bg-card"}
            >
              <SafeText value={c.body} className="space-y-2 text-sm" />
            </TimelineItem>
          ))}

          {ticket.resolution && (
            <section aria-label="Solução" className="ml-11 rounded-md border border-sky-500/40 bg-sky-500/[0.06] p-4">
              <h2 className="mb-2 flex items-center gap-2 font-medium">
                <CircleCheckIcon aria-hidden className="size-4 text-sky-300" />
                Solução
              </h2>
              <SafeText value={ticket.resolution} className="prose-sm space-y-2" />
            </section>
          )}

          <div className="ml-11 flex flex-col gap-4">
            {visibleComments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
            <AiSummaryCard ticketId={ticket.id} view={summaryView} />
            <AiDraftCard key={draftView.draft?.id ?? "sem-rascunho"} ticketId={ticket.id} available={draftView.available} draft={draftView.draft} />
            {can(user, "comment:create", ticket) && (
              <section className="rounded-md border border-white/10 bg-card p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <MessageSquareIcon aria-hidden className="size-4" />
                  Responder
                </h2>
                <CommentForm ticketId={ticket.id} canInternal={can(user, "comment:read_internal", ticket)} />
              </section>
            )}
          </div>
        </div>

        <aside className="flex flex-col overflow-hidden rounded-md border border-white/10 bg-card text-sm">
          <PanelSection icon={CircleAlertIcon} title="Chamado">
            <dl className="flex flex-col gap-2">
              <Field label="Data de abertura">{formatDateTime(ticket.createdAt)}</Field>
              <Field label="Tipo">{TYPE_LABEL[ticket.type]}</Field>
              <Field label="Categoria">{ticket.category?.name ?? "—"}</Field>
              <Field label="Status">
                <StatusBadge status={ticket.status} />
              </Field>
              <Field label="Prioridade">
                <PriorityBadge priority={ticket.priority} />
              </Field>
              {ticket.firstResponseDue && (
                <Field label="1ª resposta">
                  {ticket.firstRespondedAt
                    ? `respondido em ${formatDateTime(ticket.firstRespondedAt)}`
                    : `até ${formatDateTime(ticket.firstResponseDue)}`}
                </Field>
              )}
              {ticket.resolutionDue && <Field label="Resolução até">{formatDateTime(ticket.resolutionDue)}</Field>}
              {ticket.resolvedAt && <Field label="Resolvido em">{formatDateTime(ticket.resolvedAt)}</Field>}
              {ticket.source === "API" && <Field label="Origem">{`Aberto via API (${ticket.apiKey?.name ?? "chave removida"})`}</Field>}
            </dl>
          </PanelSection>

          <PanelSection icon={UsersIcon} title="Atores">
            <dl className="flex flex-col gap-3">
              <Actor label="Requerente" icon={UserIcon} name={ticket.requester.name} />
              <Actor label="Atribuído" icon={UserIcon} name={ticket.assignee?.name} />
              <Actor label="Equipe" icon={UsersIcon} name={ticket.team?.name} />
            </dl>
          </PanelSection>

          {(next.length > 0 || canAssign || canRateLate || can(user, "ticket:take", ticket) || can(user, "ticket:reopen", ticket)) && (
            <PanelSection icon={ZapIcon} title="Ações">
              <div className="flex flex-col gap-3">
                <StatusControl ticketId={ticket.id} next={next} />
                <TicketActions
                  ticketId={ticket.id}
                  // Assumir exige ser membro da equipe do chamado (o serviço valida); só oferece a quem é.
                  canTake={can(user, "ticket:take", ticket) && !!ticket.teamId && user.teamIds.includes(ticket.teamId)}
                  canReopen={can(user, "ticket:reopen", ticket)}
                  canAssign={canAssign}
                  teams={assignmentTeams}
                  current={{ teamId: ticket.teamId, assigneeId: ticket.assigneeId }}
                  rated={!!rating}
                />
                {canRateLate && <LateRating ticketId={ticket.id} />}
              </div>
            </PanelSection>
          )}

          {rating && (
            <PanelSection icon={StarIcon} title="Avaliação" label="Avaliação do atendimento">
              <p aria-label={`Nota ${rating.stars} de 5`} className="text-lg text-amber-400">
                {"★".repeat(rating.stars)}
                <span className="text-muted-foreground/50">{"★".repeat(5 - rating.stars)}</span>
              </p>
              {rating.comment && <p className="whitespace-pre-wrap text-muted-foreground">{rating.comment}</p>}
            </PanelSection>
          )}

          <PanelSection icon={PaperclipIcon} title="Anexos" count={attachments.length}>
            {attachments.length === 0 && <p className="text-muted-foreground">Nenhum anexo.</p>}
            <ul className="flex flex-col gap-1">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a href={`/api/tickets/${ticket.id}/attachments/${a.id}`} className="underline underline-offset-4" download>
                    {a.filename}
                  </a>{" "}
                  <span className="text-xs text-muted-foreground">({Math.ceil(a.size / 1024)} KB)</span>
                </li>
              ))}
            </ul>
            {can(user, "attachment:add", ticket) && (
              <div className="mt-2">
                <AttachmentForm ticketId={ticket.id} />
              </div>
            )}
          </PanelSection>
        </aside>
      </div>
    </div>
  );
}

/** Bolha da linha do tempo: avatar à esquerda, cabeçalho com autor e data. */
function TimelineItem({
  author,
  meta,
  tag,
  className,
  children,
}: {
  author: string;
  meta: string;
  tag?: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex gap-3">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-white/10 text-xs font-semibold">
        {author.slice(0, 1).toUpperCase()}
      </span>
      <div className={`min-w-0 flex-1 rounded-md border p-4 ${className}`}>
        <header className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 rounded bg-white/[0.07] px-2 py-0.5">
            <UserIcon aria-hidden className="size-3" />
            <strong className="font-medium text-foreground">{author}</strong>
          </span>
          <span className="flex items-center gap-1 rounded bg-white/[0.07] px-2 py-0.5">
            <ClockIcon aria-hidden className="size-3" />
            {meta}
          </span>
          {tag && <Badge variant="outline">{tag}</Badge>}
        </header>
        {children}
      </div>
    </article>
  );
}

function PanelSection({
  icon: Icon,
  title,
  label,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  label?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 border-b border-white/10 p-4 last:border-b-0">
      <h2 className="flex items-center gap-2 font-medium">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        {title}
        {count !== undefined && count > 0 && <span className="rounded bg-white/10 px-1.5 text-xs tabular-nums">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/** Linha "rótulo | valor" como no formulário do GLPI. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
      <dt className="text-right text-xs text-muted-foreground">{label}</dt>
      <dd className="min-h-8 rounded-md border border-white/10 bg-background px-2.5 py-1.5">{children}</dd>
    </div>
  );
}

function Actor({ label, icon: Icon, name }: { label: string; icon: LucideIcon; name?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="rounded-md border border-white/10 bg-background px-2.5 py-1.5">
        {name ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-white/[0.07] px-2 py-0.5 text-xs">
            <Icon aria-hidden className="size-3" />
            {name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  );
}
