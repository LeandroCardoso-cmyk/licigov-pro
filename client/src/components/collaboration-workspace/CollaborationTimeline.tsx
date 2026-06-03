import { Badge } from "@/components/ui/badge";
import { MessageSquare, CheckCircle2, AtSign, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface TimelineEvent {
  id: string;
  type: "comment" | "resolve" | "mention" | "workflow";
  actor: string;
  content: string;
  createdAt: string;
}

interface CollaborationTimelineProps {
  events: TimelineEvent[];
  maxItems?: number;
}

function getEventIcon(type: TimelineEvent["type"]) {
  switch (type) {
    case "comment":
      return <MessageSquare className="w-3.5 h-3.5 text-blue-500" />;
    case "resolve":
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    case "mention":
      return <AtSign className="w-3.5 h-3.5 text-orange-500" />;
    case "workflow":
      return <Clock className="w-3.5 h-3.5 text-purple-500" />;
  }
}

function getEventLabel(type: TimelineEvent["type"]) {
  switch (type) {
    case "comment":
      return "Comentou";
    case "resolve":
      return "Resolveu";
    case "mention":
      return "Mencionou";
    case "workflow":
      return "Workflow";
  }
}

export function CollaborationTimeline({
  events,
  maxItems = 20,
}: CollaborationTimelineProps) {
  const displayed = events.slice(-maxItems).reverse();

  if (displayed.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Nenhum evento de colaboração ainda.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {displayed.map((event, idx) => (
        <div key={event.id} className="flex gap-2 text-sm">
          <div className="flex flex-col items-center">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
              {getEventIcon(event.type)}
            </div>
            {idx < displayed.length - 1 && (
              <div className="w-px flex-1 bg-border mt-1" />
            )}
          </div>
          <div className="flex-1 pb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">{event.actor}</span>
              <Badge variant="outline" className="text-xs py-0">
                {getEventLabel(event.type)}
              </Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                {format(new Date(event.createdAt), "dd/MM HH:mm", { locale: ptBR })}
              </span>
            </div>
            {event.content && (
              <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">
                {event.content}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
