import React from "react";
import { trpc } from "../../lib/trpc";
import { domainLabel, REQUEST_TYPE_LABELS, PRIORITY_LABELS, PRIORITY_CLASSES, formatDate } from "./labels";

/**
 * PendingRequests — REAL (tRPC).
 *
 * Lista enxuta das solicitações pendentes na Caixa Institucional do domínio
 * parecer_juridico (aguardando o Procurador receber). Intermediado pelo Engine.
 */

export interface PendingRequestsProps {
  limit?: number;
  onReceive?: (requestId: string) => void;
}

export default function PendingRequests({ limit = 50, onReceive }: PendingRequestsProps) {
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.legalOpinionWorkspace.listInbox.useQuery({ limit });
  const receive = trpc.legalOpinionWorkspace.receiveRequest.useMutation({
    onSuccess: (res) => {
      void utils.legalOpinionWorkspace.listInbox.invalidate();
      onReceive?.(res.workspace.requestId);
    },
  });

  const requests = data?.requests ?? [];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Pendências</h2>
          <p className="text-xs text-gray-500">Solicitações aguardando recebimento pelo Procurador.</p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
          {data?.total ?? 0} pendente(s)
        </span>
      </header>

      {isError ? (
        <p className="rounded-md border border-red-100 bg-red-50 p-4 text-center text-xs text-red-600">Não foi possível carregar as pendências.</p>
      ) : isLoading ? (
        <div className="space-y-3"><div className="h-14 animate-pulse rounded-md bg-gray-100" /><div className="h-14 animate-pulse rounded-md bg-gray-100" /></div>
      ) : requests.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">Nenhuma solicitação pendente.</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
              <div className="min-w-0">
                <p className="line-clamp-1 text-sm font-medium text-gray-900">{r.title}</p>
                <p className="text-xs text-gray-500">{domainLabel(r.sourceDomain)} · {REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType} · {formatDate(r.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PRIORITY_CLASSES[r.priority] ?? PRIORITY_CLASSES.media}`}>
                  {PRIORITY_LABELS[r.priority] ?? r.priority}
                </span>
                <button type="button" onClick={() => receive.mutate({ requestId: r.id })} disabled={receive.isPending}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">
                  {receive.isPending ? "…" : "Receber"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
