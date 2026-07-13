import React from "react";
import { trpc } from "../../lib/trpc";
import { stageLabel, STAGE_CLASSES, PROCUREMENT_TYPE_LABELS, PROCEDURE_LABELS, formatDate } from "./labels";

/**
 * DirectProcurementOverview — REAL (tRPC).
 *
 * Visão geral dos processos de contratação direta com indicadores e lista.
 */

export interface DirectProcurementOverviewProps {
  onOpen?: (workspaceId: string) => void;
}

export default function DirectProcurementOverview({ onOpen }: DirectProcurementOverviewProps) {
  const { data, isLoading } = trpc.directProcurement.listProcesses.useQuery({});
  const workspaces = data?.workspaces ?? [];

  const dispensa = workspaces.filter((w) => w.procurementType === "dispensa").length;
  const inexigibilidade = workspaces.filter((w) => w.procurementType === "inexigibilidade").length;
  const concluded = workspaces.filter((w) => ["PUBLICATION", "CONTRACT", "ARCHIVED"].includes(w.currentStage)).length;

  const kpis = [
    { label: "Total", value: workspaces.length, className: "text-gray-800" },
    { label: "Dispensa", value: dispensa, className: "text-indigo-700" },
    { label: "Inexigibilidade", value: inexigibilidade, className: "text-purple-700" },
    { label: "Concluídos", value: concluded, className: "text-green-700" },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-gray-200 bg-white p-4 text-center">
            <p className={`text-2xl font-bold ${k.className}`}>{isLoading ? "…" : k.value}</p>
            <p className="text-xs text-gray-500">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3"><h3 className="text-sm font-semibold text-gray-900">Processos</h3></div>
        {isLoading ? (
          <div className="p-4"><div className="h-14 animate-pulse rounded-md bg-gray-100" /></div>
        ) : workspaces.length === 0 ? (
          <p className="p-6 text-center text-xs text-gray-400">Nenhum processo de contratação direta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2 font-medium">Processo</th>
                  <th className="px-4 py-2 font-medium">Modalidade</th>
                  <th className="px-4 py-2 font-medium">Procedimento</th>
                  <th className="px-4 py-2 font-medium">Etapa</th>
                  <th className="px-4 py-2 font-medium">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => (
                  <tr key={w.id} onClick={() => onOpen?.(w.id)} className={onOpen ? "cursor-pointer border-b border-gray-50 hover:bg-gray-50 last:border-0" : "border-b border-gray-50 last:border-0"}>
                    <td className="px-4 py-3"><p className="font-medium text-gray-900">{w.processNumber}</p><p className="line-clamp-1 text-xs text-gray-400">{w.object}</p></td>
                    <td className="px-4 py-3 text-xs text-gray-600">{PROCUREMENT_TYPE_LABELS[w.procurementType] ?? w.procurementType}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{PROCEDURE_LABELS[w.procedureType] ?? w.procedureType}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STAGE_CLASSES[w.currentStage] ?? STAGE_CLASSES.NEW}`}>{stageLabel(w.currentStage)}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(w.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
