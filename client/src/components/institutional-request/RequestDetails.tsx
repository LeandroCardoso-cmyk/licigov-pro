import React from "react";
import { trpc } from "../../lib/trpc";
import RequestTimeline, { type TimelineEvent } from "./RequestTimeline";
import { domainLabel } from "./RequestCard";

/**
 * RequestDetails — REAL (tRPC).
 *
 * Detalhe de uma solicitação institucional. Exibe cabeçalho, referências
 * documentais (por referência — nunca cópia), a resposta (quando houver) e o
 * resumo da linha do tempo. A resposta retorna automaticamente à origem.
 */

const RESPONSE_STATUS_LABELS: Record<string, string> = {
  favoravel: "Favorável",
  desfavoravel: "Desfavorável",
  com_ressalvas: "Com Ressalvas",
  informativo: "Informativo",
  concluido: "Concluído",
};

const SIGNATURE_LABELS: Record<string, string> = {
  manual: "Manual",
  icp_brasil: "ICP-Brasil",
  gov_br: "gov.br",
  certificado_a1: "Certificado A1",
};

export interface RequestDetailsProps {
  requestId?: string;
}

export default function RequestDetails({ requestId = "" }: RequestDetailsProps) {
  const enabled = requestId.trim().length > 0;
  const { data, isLoading } = trpc.institutionalRequest.getTimeline.useQuery(
    { requestId },
    { enabled },
  );

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        Selecione uma solicitação para ver os detalhes.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div className="h-5 w-1/2 rounded bg-gray-200" />
        <div className="h-4 w-1/3 rounded bg-gray-100" />
        <div className="h-24 w-full rounded bg-gray-100" />
      </div>
    );
  }

  const timeline = data?.timeline ?? [];
  const documents = data?.documents ?? [];
  const response = data?.response ?? null;

  return (
    <div className="space-y-5">
      <header className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Solicitação {requestId}</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {timeline.length} evento(s)
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Comunicação intermediada pelo Institutional Request Engine — os domínios não conversam diretamente.
        </p>
      </header>

      {/* Referências documentais — por referência, nunca cópia */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Documentos referenciados</h3>
        <p className="mb-3 text-xs text-amber-600">
          Referência apenas — sem cópia. O documento permanece no domínio de origem.
        </p>
        {documents.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhum documento referenciado.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.title}</p>
                  <p className="text-xs text-gray-500">
                    Origem: {domainLabel(doc.originDomain)} · doc {doc.documentId} · v{doc.version}
                  </p>
                </div>
                <span className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
                  sem cópia
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Resposta — retorna automaticamente à origem */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Resposta</h3>
        {response === null ? (
          <p className="text-xs text-gray-400">Ainda sem resposta registrada.</p>
        ) : (
          <div className="rounded-md border border-green-100 bg-green-50 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                {RESPONSE_STATUS_LABELS[response.responseStatus] ?? response.responseStatus}
              </span>
              <span className="text-xs text-gray-500">Tipo: {response.responseType}</span>
              {response.signed && (
                <span className="rounded bg-white px-2 py-0.5 text-[11px] text-gray-600 ring-1 ring-inset ring-gray-200">
                  Assinado: {response.signatureMethod ? SIGNATURE_LABELS[response.signatureMethod] ?? response.signatureMethod : "—"}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-gray-800">
              {response.comments || "Sem comentários."}
            </p>
            <p className="mt-2 text-[11px] text-green-700">
              Esta resposta retornou automaticamente ao domínio de origem.
            </p>
          </div>
        )}
      </section>

      <RequestTimeline timeline={timeline as TimelineEvent[]} />
    </div>
  );
}
