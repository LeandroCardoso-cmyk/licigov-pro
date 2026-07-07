import React from "react";
import { trpc } from "../../lib/trpc";
import RequestCard, { domainLabel, type RequestCardData, type BusinessDomain } from "./RequestCard";

/**
 * InstitutionalInbox — REAL (tRPC).
 *
 * Caixa de entrada institucional de um domínio. Os domínios nunca conversam
 * diretamente: esta caixa mostra apenas as solicitações que o Institutional
 * Request Engine encaminhou para este domínio de destino. Documentos são
 * sempre referenciados (nunca copiados). A resposta retorna automaticamente
 * à origem.
 */

export interface InstitutionalInboxProps {
  domain?: BusinessDomain;
  onOpenRequest?: (id: string) => void;
}

const PENDING_STATUSES = ["NEW", "PENDING"];
const IN_PROGRESS_STATUSES = ["RECEIVED", "IN_PROGRESS", "WAITING_INFORMATION"];

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 h-4 w-3/4 rounded bg-gray-200" />
      <div className="mb-3 h-3 w-1/2 rounded bg-gray-100" />
      <div className="flex gap-2">
        <div className="h-4 w-20 rounded bg-gray-100" />
        <div className="h-4 w-16 rounded bg-gray-100" />
      </div>
    </div>
  );
}

export default function InstitutionalInbox({
  domain = "parecer_juridico",
  onOpenRequest,
}: InstitutionalInboxProps) {
  const { data, isLoading, refetch } = trpc.institutionalRequest.listPending.useQuery({ domain });
  const receiveMutation = trpc.institutionalRequest.receiveRequest.useMutation({
    onSuccess: () => {
      void refetch();
    },
  });

  const requests: RequestCardData[] = (data?.requests ?? []).map((r) => ({
    ...r,
    destinationDomain: domain,
  }));

  const pending = requests.filter((r) => PENDING_STATUSES.includes(r.status));
  const inProgress = requests.filter((r) => IN_PROGRESS_STATUSES.includes(r.status));

  const columns: Array<{ key: string; title: string; items: RequestCardData[]; canReceive: boolean }> = [
    { key: "pending", title: "Pendentes", items: pending, canReceive: true },
    { key: "in_progress", title: "Em andamento", items: inProgress, canReceive: false },
  ];

  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Caixa institucional — {domainLabel(domain)}
          </h2>
          <p className="text-xs text-gray-500">
            Solicitações encaminhadas pelo Institutional Request Engine. Documentos referenciados, nunca copiados.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
          {data?.total ?? 0} no total
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {columns.map((col) => (
          <div key={col.key} className="rounded-lg bg-white/60 p-3">
            <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-gray-700">
              {col.title}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
                {isLoading ? "…" : col.items.length}
              </span>
            </h3>

            <div className="space-y-3">
              {isLoading ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : col.items.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
                  Nenhuma solicitação.
                </p>
              ) : (
                col.items.map((req) => (
                  <div key={req.id}>
                    <RequestCard request={req} onClick={onOpenRequest} />
                    {col.canReceive && (
                      <button
                        type="button"
                        onClick={() => receiveMutation.mutate({ requestId: req.id })}
                        disabled={receiveMutation.isPending}
                        className="mt-1 w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        {receiveMutation.isPending ? "Recebendo…" : "Receber solicitação"}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
