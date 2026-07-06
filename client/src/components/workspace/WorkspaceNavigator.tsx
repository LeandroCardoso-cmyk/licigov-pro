import React from "react";
import { trpc } from "../../lib/trpc";

interface WorkspaceNavigatorProps {
  workspaceId?: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  in_review: "Em Revisão",
  awaiting_approval: "Aguardando Aprovação",
  completed: "Concluído",
  archived: "Arquivado",
};

export default function WorkspaceNavigator({
  workspaceId = "",
}: WorkspaceNavigatorProps) {
  const enabled = workspaceId.trim().length > 0;
  const { data, isLoading } = trpc.workspace.loadWorkspace.useQuery(
    { workspaceId },
    { enabled },
  );

  if (!enabled) {
    return (
      <aside className="w-64 border-r border-gray-200 bg-white p-4 text-sm text-gray-500">
        Selecione um espaço de trabalho.
      </aside>
    );
  }

  if (isLoading) {
    return (
      <aside className="w-64 animate-pulse space-y-3 border-r border-gray-200 bg-white p-4">
        <div className="h-5 w-3/4 rounded bg-gray-200" />
        <div className="h-3 w-1/2 rounded bg-gray-200" />
        <div className="h-16 w-full rounded bg-gray-100" />
      </aside>
    );
  }

  const ws = data?.workspace ?? null;

  if (!ws) {
    return (
      <aside className="w-64 border-r border-gray-200 bg-white p-4 text-sm text-gray-500">
        Espaço de trabalho não encontrado.
      </aside>
    );
  }

  const counts = [
    { label: "Tarefas", value: data?.tasks.length ?? 0 },
    { label: "Decisões", value: data?.decisions.length ?? 0 },
    { label: "Riscos", value: data?.risks.length ?? 0 },
  ];

  return (
    <aside className="w-64 border-r border-gray-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900 line-clamp-2">
        {ws.title}
      </h2>
      <p className="mb-4 text-xs text-gray-500">
        {STATUS_LABELS[ws.status] ?? ws.status} · {ws.workspaceType}
      </p>

      <div className="mb-4 rounded-lg bg-gray-50 p-3">
        <p className="text-xs uppercase tracking-wide text-gray-400">
          Etapa Atual
        </p>
        <p className="text-sm font-medium text-gray-800">{ws.currentStage}</p>
      </div>

      <ul className="space-y-2">
        {counts.map((c) => (
          <li
            key={c.label}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <span>{c.label}</span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {c.value}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="text-xs uppercase tracking-wide text-gray-400">
          Copilotos Ativos
        </p>
        <p className="mt-1 text-sm text-gray-700">
          {ws.activeCopilots.length > 0
            ? ws.activeCopilots.join(", ")
            : "Nenhum"}
        </p>
      </div>
    </aside>
  );
}
