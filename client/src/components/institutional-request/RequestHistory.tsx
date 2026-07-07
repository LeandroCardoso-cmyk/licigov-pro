import React from "react";
import {
  domainLabel,
  formatDate,
  REQUEST_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_CLASSES,
  type RequestCardData,
} from "./RequestCard";

/**
 * RequestHistory — PRESENTATIONAL.
 *
 * Histórico consolidado das solicitações de um processo/domínio, em formato de
 * tabela. Cada linha mostra o trânsito origem → destino intermediado pelo
 * Request Engine e o estado atual na máquina de estados.
 */

export interface RequestHistoryProps {
  requests?: RequestCardData[];
  onOpenRequest?: (id: string) => void;
}

const MOCK_HISTORY: RequestCardData[] = [
  {
    id: "req-0001",
    title: "Parecer inicial — Pregão 014/2026",
    sourceDomain: "processo_licitatorio",
    destinationDomain: "parecer_juridico",
    requestType: "LEGAL_OPINION_INITIAL",
    priority: "alta",
    status: "RETURNED",
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
  {
    id: "req-0002",
    title: "Revisão de controle interno — Dispensa 003/2026",
    sourceDomain: "contratacao_direta",
    destinationDomain: "controle_interno",
    requestType: "CONTROL_REVIEW",
    priority: "media",
    status: "IN_PROGRESS",
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

export default function RequestHistory({ requests = MOCK_HISTORY, onOpenRequest }: RequestHistoryProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Histórico de solicitações</h3>
        <p className="text-xs text-gray-500">Todo o trânsito institucional deste contexto, em ordem cronológica.</p>
      </div>

      {requests.length === 0 ? (
        <p className="p-6 text-center text-xs text-gray-400">Nenhuma solicitação no histórico.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 font-medium">Solicitação</th>
                <th className="px-4 py-2 font-medium">Trânsito</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => {
                const statusClass = STATUS_CLASSES[req.status] ?? STATUS_CLASSES.NEW;
                return (
                  <tr
                    key={req.id}
                    onClick={() => onOpenRequest?.(req.id)}
                    className={`border-b border-gray-50 last:border-0 ${
                      onOpenRequest ? "cursor-pointer hover:bg-gray-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <p className="line-clamp-1 font-medium text-gray-900">{req.title}</p>
                      <p className="text-xs text-gray-400">{req.id}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {domainLabel(req.sourceDomain)} <span aria-hidden className="text-gray-400">→</span>{" "}
                      {domainLabel(req.destinationDomain)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {REQUEST_TYPE_LABELS[req.requestType] ?? req.requestType}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass}`}>
                        {STATUS_LABELS[req.status] ?? req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(req.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
