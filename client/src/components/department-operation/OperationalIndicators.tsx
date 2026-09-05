import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * OperationalIndicators — REAL (tRPC).
 *
 * Indicadores operacionais consolidados dos Business Domains. NUNCA financeiros.
 */

export interface OperationalIndicatorsProps { compact?: boolean }

// V1 Visual Refinement (passagem 2): KPI institucional — número forte e NEUTRO
// (escaneável, não "dashboard financeiro colorido"); um accent semântico discreto
// (barra lateral) marca só os indicadores que pedem atenção. `alert` = vermelho.
const CARDS: Array<{ key: string; label: string; alert?: boolean }> = [
  { key: "activeProcesses", label: "Processos ativos" },
  { key: "concludedProcesses", label: "Concluídos" },
  { key: "legalOpinionsAwaiting", label: "Pareceres aguardando" },
  { key: "activeContracts", label: "Contratos ativos" },
  { key: "contractsExpiring", label: "Contratos vencendo", alert: true },
  { key: "addenda", label: "Aditivos" },
  { key: "pendingTasks", label: "Tarefas pendentes" },
  { key: "pendingRequests", label: "Solicitações pendentes" },
];

export default function OperationalIndicators({ compact: _compact = false }: OperationalIndicatorsProps) {
  const { data, isLoading } = trpc.departmentOperation.indicators.useQuery({});
  const ind = (data?.indicators ?? {}) as Record<string, number>;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {CARDS.map((c) => {
        const value = ind[c.key] ?? 0;
        const flagged = Boolean(c.alert) && value > 0;
        return (
          <div
            key={c.key}
            className={`relative overflow-hidden rounded-lg border border-border bg-card p-4 ${flagged ? "border-l-2 border-l-red-500 dark:border-l-red-400" : ""}`}
          >
            <p className="text-3xl font-bold tabular-nums leading-none text-foreground">{isLoading ? "—" : value}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{c.label}</p>
          </div>
        );
      })}
    </div>
  );
}
