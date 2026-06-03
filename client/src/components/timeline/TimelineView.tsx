import { TimelineEvent, type TimelineEventData } from "./TimelineEvent";

interface TimelineViewProps {
  events:     TimelineEventData[];
  emptyText?: string;
}

export function TimelineView({ events, emptyText = "Nenhum evento registrado" }: TimelineViewProps) {
  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-6 text-center">{emptyText}</div>
    );
  }

  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return (
    <div className="space-y-0">
      {sorted.map((event, idx) => (
        <TimelineEvent
          key={event.id}
          event={event}
          isLast={idx === sorted.length - 1}
        />
      ))}
    </div>
  );
}
