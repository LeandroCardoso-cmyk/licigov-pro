import React from "react";
import { trpc } from "../../lib/trpc";

interface WorkspaceOverviewProps {
  workspaceId?: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-blue-100 text-blue-700",
  in_review: "bg-amber-100 text-amber-700",
  awaiting_approval: "bg-orange-100 text-orange-700",
  completed: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  in_review: "Em Revisão",
  awaiting_approval: "Aguardando Aprovação",
  completed: "Concluído",
  archived: "Arquivado",
};

const SEVERITY_ORDER = ["critico", "alto", "medio", "baixo"] as const;

const SEVERITY_STYLES: Record<string, string> = {
  baixo: "bg-green-100 text-green-700",
  medio: "bg-yellow-100 text-yellow-700",
  alto: "bg-orange-100 text-orange-700",
  critico: "bg-red-100 text-red-700",
};

export default function WorkspaceOverview({
  workspaceId = "",
}: WorkspaceOverviewProps) {
  const enabled = workspaceId.trim().length > 0;
  const { data, isLoading } = trpc.workspace.loadWorkspace.useQuery(
    { workspaceId },
    { enabled },
  );

  if (!enabled) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Selecione um espaço de trabalho para ver o resumo.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 w-1/2 rounded bg-gray-200" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-gray-100" />
          ))}
        </div>
        <div className="h-32 rounded-lg bg-gray-100" />
      </div>
    );
  }

  const ws = data?.workspace ?? null;

  if (!ws) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Espaço de trabalho não encontrado.
      </div>
    );
  }

  const tasks = data?.tasks ?? [];
  const risks = data?.risks ?? [];
  const timeline = data?.timeline ?? [];

  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const openRisks = risks.filter((r) => r.status !== "mitigado").length;

  const riskBySeverity = SEVERITY_ORDER.map((sev) => ({
    severity: sev,
    count: risks.filter((r) => r.severity === sev).length,
  })).filter((r) => r.count > 0);

  const recentTimeline = [...timeline].sort((a, b) => b.order - a.order).slice(0, 5);

  const cards = [
    { label: "Tarefas", value: tasks.length },
    { label: "Concluídas", value: doneTasks },
    { label: "Decisões", value: data?.decisions.length ?? 0 },
    { label: "Riscos Abertos", value: openRisks },
  ];

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{ws.title}</h1>
          <p className="text-sm text-gray-500">
            {ws.workspaceType} · Etapa: {ws.currentStage}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[ws.status] ?? "bg-gray-100 text-gray-700"}`}
        >
          {STATUS_LABELS[ws.status] ?? ws.status}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <p className="text-2xl font-semibold text-gray-900">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Riscos por Severidade
          </h2>
          {riskBySeverity.length > 0 ? (
            <ul className="space-y-2">
              {riskBySeverity.map((r) => (
                <li
                  key={r.severity}
                  className="flex items-center justify-between"
                >
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[r.severity]}`}
                  >
                    {r.severity}
                  </span>
                  <span className="text-sm font-medium text-gray-700">
                    {r.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">Nenhum risco registrado.</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Eventos Recentes
          </h2>
          {recentTimeline.length > 0 ? (
            <ul className="space-y-2.5">
              {recentTimeline.map((event) => (
                <li key={event.id} className="flex gap-2 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                  <div className="min-w-0">
                    <p className="truncate text-gray-800">{event.summary}</p>
                    <p className="text-xs text-gray-400">
                      {event.actor} ·{" "}
                      {new Date(event.createdAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">Sem eventos.</p>
          )}
        </div>
      </div>
    </div>
  );
}
