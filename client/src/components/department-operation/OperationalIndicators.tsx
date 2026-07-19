import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * OperationalIndicators — REAL (tRPC).
 *
 * Indicadores operacionais consolidados dos Business Domains. NUNCA financeiros.
 */

export interface OperationalIndicatorsProps { compact?: boolean }

const CARDS: Array<{ key: string; label: string; className: string }> = [
  { key: "activeProcesses", label: "Processos ativos", className: "text-indigo-700" },
  { key: "concludedProcesses", label: "Concluídos", className: "text-green-700" },
  { key: "legalOpinionsAwaiting", label: "Pareceres aguardando", className: "text-yellow-700" },
  { key: "activeContracts", label: "Contratos ativos", className: "text-blue-700" },
  { key: "contractsExpiring", label: "Contratos vencendo", className: "text-red-700" },
  { key: "addenda", label: "Aditivos", className: "text-purple-700" },
  { key: "pendingTasks", label: "Tarefas pendentes", className: "text-amber-700" },
  { key: "pendingRequests", label: "Solicitações pendentes", className: "text-teal-700" },
];

export default function OperationalIndicators({ compact = false }: OperationalIndicatorsProps) {
  const { data, isLoading } = trpc.departmentOperation.indicators.useQuery({});
  const ind = (data?.indicators ?? {}) as Record<string, number>;

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
      {CARDS.map((c) => (
        <div key={c.key} className="rounded-lg border border-border bg-card p-4 text-center">
          <p className={`text-2xl font-bold ${c.className}`}>{isLoading ? "…" : (ind[c.key] ?? 0)}</p>
          <p className="text-xs text-muted-foreground">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
