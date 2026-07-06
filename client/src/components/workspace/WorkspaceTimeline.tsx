import React from "react";
import { trpc } from "../../lib/trpc";

interface WorkspaceTimelineProps {
  workspaceId?: string;
}

export default function WorkspaceTimeline({
  workspaceId = "",
}: WorkspaceTimelineProps) {
  const enabled = workspaceId.trim().length > 0;
  const { data, isLoading } = trpc.workspace.getTimeline.useQuery(
    { workspaceId },
    { enabled },
  );

  if (!enabled) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Selecione um espaço de trabalho para visualizar a linha do tempo.
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Linha do Tempo
      </h2>

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex animate-pulse gap-3">
              <div className="h-3 w-3 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded bg-gray-200" />
                <div className="h-3 w-2/3 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && data && data.timeline.length > 0 && (
        <ol className="relative border-l border-gray-200">
          {data.timeline.map((event) => (
            <li key={event.id} className="mb-6 ml-4">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-blue-500" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400">
                  #{event.order}
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {event.eventType}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(event.createdAt).toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-800">{event.summary}</p>
              <p className="text-xs text-gray-500">Ator: {event.actor}</p>
            </li>
          ))}
        </ol>
      )}

      {!isLoading && data && data.timeline.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          Nenhum evento registrado ainda.
        </div>
      )}
    </div>
  );
}
