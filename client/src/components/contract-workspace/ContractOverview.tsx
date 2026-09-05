import React from "react";
import { trpc } from "../../lib/trpc";
import { originLabel, statusLabel, STATUS_CLASSES, formatCurrency, formatDate } from "./labels";

/**
 * ContractOverview — REAL (tRPC).
 * Visão geral dos contratos com indicadores e lista.
 */

export interface ContractOverviewProps { onOpen?: (contractId: string) => void }

export default function ContractOverview({ onOpen }: ContractOverviewProps) {
  const { data, isLoading } = trpc.contractWorkspace.listContracts.useQuery({});
  const contracts = data?.contracts ?? [];

  const vigentes = contracts.filter((c) => c.status === "vigente").length;
  const externos = contracts.filter((c) => c.originType === "externo").length;

  const kpis = [
    { label: "Total", value: contracts.length, className: "text-foreground" },
    { label: "Vigentes", value: vigentes, className: "text-green-700 dark:text-green-300" },
    { label: "Externos", value: externos, className: "text-indigo-700 dark:text-indigo-300" },
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-border bg-card p-4 text-center">
            <p className={`text-2xl font-bold ${k.className}`}>{isLoading ? "…" : k.value}</p>
            <p className="text-xs text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold text-foreground">Contratos</h3></div>
        {isLoading ? (
          <div className="p-4"><div className="h-14 animate-pulse rounded-md bg-muted" /></div>
        ) : contracts.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">Nenhum contrato.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Contrato</th>
                  <th className="px-4 py-2 font-medium">Origem</th>
                  <th className="px-4 py-2 font-medium">Valor</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} onClick={() => onOpen?.(c.id)} className={onOpen ? "cursor-pointer border-b border-border hover:bg-muted last:border-0" : "border-b border-border last:border-0"}>
                    <td className="px-4 py-3"><p className="font-medium text-foreground">{c.contractNumber}</p><p className="line-clamp-1 text-xs text-muted-foreground">{c.contractor || c.object}</p></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{originLabel(c.originType)}</td>
                    <td className="px-4 py-3 text-xs text-foreground">{formatCurrency(c.value)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_CLASSES[c.status] ?? STATUS_CLASSES.minuta}`}>{statusLabel(c.status)}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(c.updatedAt)}</td>
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
