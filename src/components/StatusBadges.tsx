import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/labels";

const STATUS_STYLE: Record<string, string> = {
  NEW: "bg-sky-500/15 text-sky-300",
  OPEN: "bg-indigo-500/15 text-indigo-300",
  PENDING: "bg-amber-500/15 text-amber-300",
  RESOLVED: "bg-emerald-500/15 text-emerald-300",
  CLOSED: "bg-zinc-500/20 text-zinc-300",
};
const PRIORITY_STYLE: Record<string, string> = {
  LOW: "bg-zinc-500/15 text-zinc-300",
  MEDIUM: "bg-sky-500/15 text-sky-300",
  HIGH: "bg-orange-500/15 text-orange-300",
  CRITICAL: "bg-red-500/20 text-red-300",
};

// Bolinha à moda do GLPI: cheia para novo, vazada para em atendimento, etc.
const STATUS_DOT: Record<string, string> = {
  NEW: "bg-sky-400",
  OPEN: "border-2 border-indigo-400",
  PENDING: "bg-amber-400",
  RESOLVED: "border-2 border-emerald-400",
  CLOSED: "bg-zinc-500",
};

export const StatusDot = ({ status, className = "size-2" }: { status: string; className?: string }) => (
  <span aria-hidden className={`shrink-0 rounded-full ${className} ${STATUS_DOT[status]}`} />
);

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant="outline" className={`border-0 ${STATUS_STYLE[status]}`}>
    <StatusDot status={status} />
    {STATUS_LABEL[status]}
  </Badge>
);
export const PriorityBadge = ({ priority }: { priority: string }) => (
  <Badge variant="outline" className={`border-0 ${PRIORITY_STYLE[priority]}`}>
    {PRIORITY_LABEL[priority]}
  </Badge>
);
