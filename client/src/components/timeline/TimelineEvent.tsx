import {
  Upload, FileText, Zap, GitMerge, CheckCircle,
  XCircle, Edit, FileCheck, HelpCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type EventType =
  | "import"
  | "parse"
  | "normalize"
  | "review"
  | "approve"
  | "reject"
  | "override"
  | "compose";

export interface TimelineEventData {
  id:          string;
  type:        EventType;
  timestamp:   string;
  actor?:      string;
  description: string;
}

interface TimelineEventProps {
  event:      TimelineEventData;
  isLast?:    boolean;
}

const eventConfig: Record<EventType, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  iconColor: string;
  dotColor: string;
}> = {
  import:    { icon: Upload,      label: "Importação",    iconColor: "text-blue-600",   dotColor: "bg-blue-500" },
  parse:     { icon: FileText,    label: "Parser",        iconColor: "text-purple-600", dotColor: "bg-purple-500" },
  normalize: { icon: Zap,         label: "Normalização",  iconColor: "text-orange-600", dotColor: "bg-orange-500" },
  review:    { icon: GitMerge,    label: "Revisão",       iconColor: "text-yellow-600", dotColor: "bg-yellow-500" },
  approve:   { icon: CheckCircle, label: "Aprovação",     iconColor: "text-green-600",  dotColor: "bg-green-500" },
  reject:    { icon: XCircle,     label: "Rejeição",      iconColor: "text-red-600",    dotColor: "bg-red-500" },
  override:  { icon: Edit,        label: "Override",      iconColor: "text-yellow-700", dotColor: "bg-yellow-600" },
  compose:   { icon: FileCheck,   label: "Composição TR", iconColor: "text-indigo-600", dotColor: "bg-indigo-500" },
};

export function TimelineEvent({ event, isLast = false }: TimelineEventProps) {
  const config = eventConfig[event.type] ?? {
    icon:      HelpCircle,
    label:     event.type,
    iconColor: "text-gray-500",
    dotColor:  "bg-gray-400",
  };
  const Icon = config.icon;

  return (
    <div className="flex gap-3">
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full shrink-0 mt-1 ${config.dotColor}`} />
        {!isLast && <div className="w-0.5 bg-border flex-1 mt-1" />}
      </div>

      {/* Content */}
      <div className="pb-4 flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className={`h-4 w-4 ${config.iconColor}`} />
          <Badge variant="outline" className="text-xs">{config.label}</Badge>
          {event.actor && (
            <span className="text-xs text-muted-foreground">{event.actor}</span>
          )}
          <time className="text-xs text-muted-foreground ml-auto">
            {new Date(event.timestamp).toLocaleString("pt-BR", {
              day:    "2-digit",
              month:  "2-digit",
              year:   "numeric",
              hour:   "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        <p className="text-sm">{event.description}</p>
      </div>
    </div>
  );
}
