import React from "react";
import { trpc } from "../../lib/trpc";
import RequestCard, { domainLabel, type RequestCardData, type BusinessDomain } from "./RequestCard";

/**
 * PendingRequests — REAL (tRPC).
 *
 * Fila de solicitações pendentes de um domínio de destino. Lista tudo o que o
 * Institutional Request Engine encaminhou e ainda aguarda tratamento. Os
 * domínios não conversam diretamente — só existe esta fila intermediada.
 */

export interface PendingRequestsProps {
  domain?: BusinessDomain;
  limit?: number;
  onOpenRequest?: (id: string) => void;
}

function RowSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 h-4 w-2/3 rounded bg-gray-200" />
      <div className="h-3 w-1/3 rounded bg-gray-100" />
    </div>
  );
}

export default function PendingRequests({
  domain = "parecer_juridico",
  limit = 50,
  onOpenRequest,
}: PendingRequestsProps) {
  const { data, isLoading, isError } = trpc.institutionalRequest.listPending.useQuery({
    domain,
    limit,
  });

  const requests: RequestCardData[] = (data?.requests ?? []).map((r) => ({
    ...r,
    destinationDomain: domain,
  }));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Pendentes — {domainLabel(domain)}</h2>
          <p className="text-xs text-gray-500">
            Solicitações aguardando tratamento neste domínio de destino.
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
          {data?.total ?? 0} pendente(s)
        </span>
      </header>

      {isError ? (
        <p className="rounded-md border border-red-100 bg-red-50 p-4 text-center text-xs text-red-600">
          Não foi possível carregar as solicitações pendentes.
        </p>
      ) : isLoading ? (
        <div className="space-y-3">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : requests.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
          Nenhuma solicitação pendente.
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <RequestCard key={req.id} request={req} onClick={onOpenRequest} />
          ))}
        </div>
      )}
    </section>
  );
}
