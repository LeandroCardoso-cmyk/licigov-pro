import React from "react";
import { trpc } from "../../lib/trpc";
import { stageLabel, domainLabel, STAGE_CLASSES, REQUEST_TYPE_LABELS, PRIORITY_LABELS, formatDate } from "./labels";

/**
 * LawyerDashboard — REAL (tRPC).
 *
 * Painel do Procurador: seus trabalhos atribuídos e indicadores de produtividade.
 * Reflete apenas o domínio parecer_juridico — nenhum acesso direto a outros domínios.
 */

export interface LawyerDashboardProps {
  onOpenWorkspace?: (workspaceId: string) => void;
}

export default function LawyerDashboard({ onOpenWorkspace }: LawyerDashboardProps) {
  const { data, isLoading } = trpc.legalOpinionWorkspace.lawyerDashboard.useQuery();

  const workspaces = data?.workspaces ?? [];
  const assignments = data?.assignments ?? [];
  const emitted = workspaces.filter((w) => ["SIGNED", "RETURNED", "ARCHIVED"].includes(w.currentStage)).length;
  const active = workspaces.filter((w) => !["RETURNED", "ARCHIVED"].includes(w.currentStage)).length;

  const kpis = [
    { label: "Atribuídos", value: assignments.length, className: "text-indigo-700" },
    { label: "Em andamento", value: active, className: "text-blue-700" },
    { label: "Emitidos", value: emitted, className: "text-green-700" },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-gray-200 bg-white p-4 text-center">
            <p className={`text-2xl font-bold ${k.className}`}>{isLoading ? "…" : k.value}</p>
            <p className="text-xs text-gray-500">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Meus trabalhos</h3>
        </div>
        {isLoading ? (
          <div className="p-4"><div className="h-14 animate-pulse rounded-md bg-gray-100" /></div>
        ) : workspaces.length === 0 ? (
          <p className="p-6 text-center text-xs text-gray-400">Nenhum trabalho atribuído.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => onOpenWorkspace?.(w.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{REQUEST_TYPE_LABELS[w.requestType] ?? w.requestType}</p>
                    <p className="text-xs text-gray-500">{domainLabel(w.sourceDomain)} · {PRIORITY_LABELS[w.priority] ?? w.priority} · {formatDate(w.updatedAt)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STAGE_CLASSES[w.currentStage] ?? STAGE_CLASSES.INBOX}`}>
                    {stageLabel(w.currentStage)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
