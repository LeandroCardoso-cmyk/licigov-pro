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
    { label: "Total", value: workspaces.length, className: "text-foreground" },
    { label: "Dispensa", value: dispensa, className: "text-indigo-700 dark:text-indigo-300" },
    { label: "Inexigibilidade", value: inexigibilidade, className: "text-purple-700 dark:text-purple-300" },
    { label: "Concluídos", value: concluded, className: "text-green-700 dark:text-green-300" },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-border bg-card p-4 text-center">
            <p className={`text-2xl font-bold ${k.className}`}>{isLoading ? "…" : k.value}</p>
            <p className="text-xs text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold text-foreground">Processos</h3></div>
        {isLoading ? (
          <div className="p-4"><div className="h-14 animate-pulse rounded-md bg-muted" /></div>
        ) : workspaces.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">Nenhum processo de contratação direta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Processo</th>
                  <th className="px-4 py-2 font-medium">Modalidade</th>
                  <th className="px-4 py-2 font-medium">Procedimento</th>
                  <th className="px-4 py-2 font-medium">Etapa</th>
                  <th className="px-4 py-2 font-medium">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => (
                  <tr key={w.id} onClick={() => onOpen?.(w.id)} className={onOpen ? "cursor-pointer border-b border-border hover:bg-muted last:border-0" : "border-b border-border last:border-0"}>
                    <td className="px-4 py-3"><p className="font-medium text-foreground">{w.processNumber}</p><p className="line-clamp-1 text-xs text-muted-foreground">{w.object}</p></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{PROCUREMENT_TYPE_LABELS[w.procurementType] ?? w.procurementType}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{PROCEDURE_LABELS[w.procedureType] ?? w.procedureType}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STAGE_CLASSES[w.currentStage] ?? STAGE_CLASSES.NEW}`}>{stageLabel(w.currentStage)}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(w.updatedAt)}</td>
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
