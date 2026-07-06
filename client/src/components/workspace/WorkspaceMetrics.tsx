import React from "react";
import { trpc } from "../../lib/trpc";

interface WorkspaceMetricsProps {
  workspaceId?: string;
}

export default function WorkspaceMetrics({
  workspaceId = "",
}: WorkspaceMetricsProps) {
  const enabled = workspaceId.trim().length > 0;
  const { data, isLoading } = trpc.workspace.getMetrics.useQuery(
    { workspaceId },
    { enabled },
  );

  if (!enabled) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Selecione um espaço de trabalho para ver as métricas.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="mb-2 h-6 w-10 rounded bg-gray-200" />
            <div className="h-3 w-16 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  const flow = data?.flow;
  const cards = [
    { label: "Total de Tarefas", value: data?.taskCount ?? 0, accent: "text-gray-900" },
    { label: "Pendentes", value: flow?.pending ?? 0, accent: "text-gray-700" },
    { label: "Em Andamento", value: flow?.inProgress ?? 0, accent: "text-blue-600" },
    { label: "Bloqueadas", value: flow?.blocked ?? 0, accent: "text-red-600" },
    { label: "Em Revisão", value: flow?.inReview ?? 0, accent: "text-amber-600" },
    { label: "Concluídas", value: flow?.done ?? 0, accent: "text-green-600" },
  ];

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Métricas de Fluxo
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <p className={`text-2xl font-semibold ${c.accent}`}>{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      {flow?.bottleneck ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>Gargalo detectado:</strong> {flow.bottleneck}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Nenhum gargalo detectado no fluxo atual.
        </div>
      )}
    </div>
  );
}
