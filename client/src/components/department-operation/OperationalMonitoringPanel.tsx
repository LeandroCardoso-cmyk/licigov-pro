import React from "react";
import { trpc } from "../../lib/trpc";
import { SITUATION_CLASSES, SITUATION_LABELS, RECORD_TYPE_LABELS } from "./labels";

/**
 * OperationalMonitoringPanel — REAL (tRPC).
 *
 * ÁREA 2 — Painel de Acompanhamento: substitui a planilha por uma versão inteligente.
 * Cada linha = uma contratação; a informação vem automaticamente dos Business Domains.
 * Situação Geral por cores (verde/amarelo/azul/vermelho/cinza).
 */

export interface OperationalMonitoringPanelProps { onOpen?: (id: string) => void }

const ORIGIN_LABELS: Record<string, string> = {
  processo_licitatorio: "Processo Licitatório", contratacao_direta: "Contratação Direta",
};

export default function OperationalMonitoringPanel({ onOpen }: OperationalMonitoringPanelProps) {
  const { data, isLoading } = trpc.departmentOperation.monitoringPanel.useQuery({});
  const rows = data?.rows ?? [];

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Painel de Acompanhamento</h3>
          <p className="text-xs text-gray-400">Substitui a planilha — consolidado automaticamente dos domínios.</p>
        </div>
        <div className="hidden gap-2 sm:flex">
          {Object.entries(SITUATION_LABELS).map(([k, label]) => (
            <span key={k} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${SITUATION_CLASSES[k]}`}>{label}</span>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="p-4"><div className="h-14 animate-pulse rounded-md bg-gray-100" /></div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-xs text-gray-400">Nenhuma contratação para acompanhar.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 font-medium">Processo</th>
                <th className="px-4 py-2 font-medium">Objeto</th>
                <th className="px-4 py-2 font-medium">Origem</th>
                <th className="px-4 py-2 font-medium">Etapa Atual</th>
                <th className="px-4 py-2 font-medium">Situação Geral</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.processId} onClick={() => onOpen?.(r.processId)} className={onOpen ? "cursor-pointer border-b border-gray-50 hover:bg-gray-50 last:border-0" : "border-b border-gray-50 last:border-0"}>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.processNumber}</td>
                  <td className="px-4 py-3"><p className="line-clamp-1 text-xs text-gray-600">{r.object}</p></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{ORIGIN_LABELS[r.origin] ?? RECORD_TYPE_LABELS[r.origin] ?? r.origin}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{r.currentStage}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${SITUATION_CLASSES[r.situation] ?? SITUATION_CLASSES.cinza}`}>{SITUATION_LABELS[r.situation] ?? r.situation}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
