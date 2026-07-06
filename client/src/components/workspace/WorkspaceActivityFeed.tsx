import React from "react";
import { trpc } from "../../lib/trpc";

interface WorkspaceActivityFeedProps {
  workspaceId?: string;
}

export default function WorkspaceActivityFeed({
  workspaceId = "",
}: WorkspaceActivityFeedProps) {
  const enabled = workspaceId.trim().length > 0;
  const { data, isLoading } = trpc.workspace.getTimeline.useQuery(
    { workspaceId },
    { enabled },
  );

  if (!enabled) {
    return (
      <div className="p-4 text-sm text-gray-500">
        Selecione um espaço de trabalho.
      </div>
    );
  }

  const events = data ? [...data.timeline].sort((a, b) => b.order - a.order) : [];

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Atividade Recente
      </h2>

      {isLoading && (
        <ul className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex animate-pulse items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-gray-200" />
              <div className="h-3 flex-1 rounded bg-gray-100" />
            </li>
          ))}
        </ul>
      )}

      {!isLoading && events.length > 0 && (
        <ul className="space-y-2.5">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
              <div className="min-w-0">
                <p className="truncate text-gray-800">{event.summary}</p>
                <p className="text-xs text-gray-400">
                  {event.actor} ·{" "}
                  {new Date(event.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && events.length === 0 && (
        <p className="text-sm text-gray-400">Sem atividades registradas.</p>
      )}
    </div>
  );
}
