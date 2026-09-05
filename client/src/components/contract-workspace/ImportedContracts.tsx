import React from "react";
import { trpc } from "../../lib/trpc";
import { statusLabel, STATUS_CLASSES, formatCurrency, formatDate } from "./labels";

/**
 * ImportedContracts — REAL (tRPC).
 *
 * Lista os contratos EXTERNOS importados (fluxo obrigatório). Nenhuma prefeitura
 * começa apenas com contratos novos — este é o ponto de entrada do acervo existente.
 */

export interface ImportedContractsProps { onOpen?: (contractId: string) => void }

export default function ImportedContracts({ onOpen }: ImportedContractsProps) {
  const { data, isLoading } = trpc.contractWorkspace.listImported.useQuery({});
  const contracts = data?.contracts ?? [];

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Contratos importados</h3>
        <p className="text-xs text-muted-foreground">Acervo externo reconstruído a partir de PDF/DOCX.</p>
      </div>
      {isLoading ? (
        <div className="p-4"><div className="h-14 animate-pulse rounded-md bg-muted" /></div>
      ) : contracts.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">Nenhum contrato importado ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contracts.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onOpen?.(c.id)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{c.contractNumber}</p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{c.contractor || c.object} · {formatCurrency(c.value)} · {formatDate(c.updatedAt)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_CLASSES[c.status] ?? STATUS_CLASSES.vigente}`}>{statusLabel(c.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
