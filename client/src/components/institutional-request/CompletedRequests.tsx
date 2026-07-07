import React from "react";
import { trpc } from "../../lib/trpc";
import RequestCard, { domainLabel, type RequestCardData, type BusinessDomain } from "./RequestCard";

/**
 * CompletedRequests — REAL (tRPC).
 *
 * Solicitações concluídas/devolvidas de um domínio. O alternador origem/destino
 * permite ver tanto o que este domínio respondeu (como destino) quanto o que
 * recebeu de volta (como origem). Tudo intermediado pelo Request Engine.
 */

export interface CompletedRequestsProps {
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

export default function CompletedRequests({
  domain = "parecer_juridico",
  limit = 50,
  onOpenRequest,
}: CompletedRequestsProps) {
  const [asSource, setAsSource] = React.useState(false);
  const { data, isLoading, isError } = trpc.institutionalRequest.listCompleted.useQuery({
    domain,
    asSource,
    limit,
  });

  // A consulta de concluídas retorna um resumo enxuto; preenchemos o trânsito
  // origem → destino a partir do lado conhecido (este domínio) e do alternador.
  const requests: RequestCardData[] = (data?.requests ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    requestType: r.requestType,
    status: r.status,
    priority: "media",
    sourceDomain: asSource ? domain : "",
    destinationDomain: asSource ? "" : domain,
    createdAt: r.updatedAt,
  }));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Concluídas — {domainLabel(domain)}</h2>
          <p className="text-xs text-gray-500">
            {asSource
              ? "Solicitações que este domínio originou e recebeu de volta."
              : "Solicitações que este domínio respondeu como destino."}
          </p>
        </div>
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setAsSource(false)}
            className={`rounded-md px-3 py-1 transition ${
              asSource ? "text-gray-500 hover:text-gray-700" : "bg-white text-gray-900 shadow-sm"
            }`}
          >
            Como destino
          </button>
          <button
            type="button"
            onClick={() => setAsSource(true)}
            className={`rounded-md px-3 py-1 transition ${
              asSource ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Como origem
          </button>
        </div>
      </header>

      {isError ? (
        <p className="rounded-md border border-red-100 bg-red-50 p-4 text-center text-xs text-red-600">
          Não foi possível carregar as solicitações concluídas.
        </p>
      ) : isLoading ? (
        <div className="space-y-3">
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : requests.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
          Nenhuma solicitação concluída.
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
