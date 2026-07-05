import React from "react";
import { trpc } from "../../lib/trpc";

const STATUS_BADGE: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  reasoning: "bg-blue-100 text-blue-700",
  recommended: "bg-indigo-100 text-indigo-700",
  awaiting_approval: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  closed: "bg-gray-100 text-gray-700",
};

const COPILOT_LABEL: Record<string, string> = {
  agente_contratacao: "Agente de Contratação",
  pregoeiro: "Pregoeiro",
  planejamento: "Planejamento",
  tr_intelligence: "TR Intelligence",
  juridico: "Jurídico",
  pesquisa_precos: "Pesquisa de Preços",
  contratos: "Contratos",
  controle_interno: "Controle Interno",
};

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("pt-BR");
}

export default function CopilotHistoryViewer() {
  const history = trpc.copilot.getHistory.useQuery({ limit: 50 });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Histórico de Sessões</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-4">Copiloto</th>
              <th className="py-2 pr-4">Consulta</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {history.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={4} className="py-3">
                    <div className="h-6 w-full animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))
            ) : history.data && history.data.sessions.length > 0 ? (
              history.data.sessions.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="py-3 pr-4 text-gray-800">
                    {COPILOT_LABEL[s.copilotType] ?? s.copilotType}
                  </td>
                  <td className="py-3 pr-4 text-gray-600" title={s.query}>
                    {truncate(s.query)}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="py-3 text-gray-500">{fmtDate(s.createdAt)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-8 text-center text-gray-400">
                  Nenhuma sessão registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
