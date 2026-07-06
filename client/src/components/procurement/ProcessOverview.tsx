import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * ProcessOverview — REAL (wired to tRPC).
 *
 * UX: visão consolidada de um processo. Reúne cabeçalho, contagem de itens por
 * status, documentos gerados e eventos recentes. É a tela de leitura/revisão do
 * andamento — não um formulário.
 */

const STAGE_LABELS: Record<string, string> = {
  NEW_PROCESS: "Novo Processo",
  DFD: "DFD",
  ETP: "ETP",
  PRICE_RESEARCH: "Pesquisa de Preços",
  ITEM_WORKSPACE: "Workspace de Itens",
  TR: "Termo de Referência",
  NOTICE: "Edital",
  REVIEW: "Revisão",
  ISSUED: "Emitido",
  ARCHIVED: "Arquivado",
};

const PROCESS_STATUS_CLASSES: Record<string, string> = {
  rascunho: "bg-gray-100 text-gray-700",
  em_andamento: "bg-blue-100 text-blue-700",
  em_revisao: "bg-amber-100 text-amber-700",
  emitido: "bg-green-100 text-green-700",
  arquivado: "bg-gray-100 text-gray-500",
};

const ITEM_STATUS_META: { key: string; label: string; className: string }[] = [
  { key: "pendente", label: "Pendentes", className: "bg-gray-100 text-gray-700" },
  { key: "em_analise", label: "Em análise", className: "bg-blue-100 text-blue-700" },
  { key: "aprovado", label: "Aprovados", className: "bg-green-100 text-green-700" },
  { key: "rejeitado", label: "Rejeitados", className: "bg-red-100 text-red-700" },
];

export type ProcessOverviewProps = {
  processId?: string;
};

export default function ProcessOverview({
  processId = "",
}: ProcessOverviewProps) {
  const { data, isLoading } = trpc.procurementProcess.loadProcess.useQuery(
    { processId },
    { enabled: !!processId },
  );

  if (!processId) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Selecione um processo para ver o resumo.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 p-2">
        <div className="h-20 rounded-xl bg-gray-100" />
        <div className="h-24 rounded-xl bg-gray-100" />
        <div className="h-40 rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (!data || !data.process) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Processo não encontrado.
      </div>
    );
  }

  const { process, items, timeline, documents } = data;
  const counts: Record<string, number> = {};
  for (const it of items) {
    counts[it.status] = (counts[it.status] ?? 0) + 1;
  }
  const recentTimeline = [...timeline]
    .sort((a, b) => b.order - a.order)
    .slice(0, 5);

  return (
    <div className="space-y-4 p-2">
      {/* Cabeçalho */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm font-semibold text-gray-900">
              {process.processNumber}
            </p>
            <p className="mt-1 text-gray-700">{process.object}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              PROCESS_STATUS_CLASSES[process.status] ??
              "bg-gray-100 text-gray-700"
            }`}
          >
            {process.status}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-md bg-indigo-50 px-2 py-1 text-indigo-700">
            Etapa: {STAGE_LABELS[process.currentStage] ?? process.currentStage}
          </span>
          <span className="rounded-md bg-gray-50 px-2 py-1 text-gray-600">
            Modalidade: {process.modality || "—"}
          </span>
          <span className="rounded-md bg-gray-50 px-2 py-1 text-gray-600">
            Copilotos: {process.activeCopilots.length}
          </span>
        </div>
      </div>

      {/* Contagem de itens por status */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ITEM_STATUS_META.map((m) => (
          <div
            key={m.key}
            className="rounded-xl border border-gray-200 bg-white p-4 text-center"
          >
            <p className="text-2xl font-semibold text-gray-900">
              {counts[m.key] ?? 0}
            </p>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${m.className}`}
            >
              {m.label}
            </span>
          </div>
        ))}
      </div>

      {/* Documentos */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold text-gray-900">
          Documentos gerados
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum documento ainda.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium uppercase text-gray-600">
                    {d.kind}
                  </span>
                  <span className="text-sm text-gray-800">{d.title}</span>
                </div>
                <span className="text-xs text-gray-500">{d.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Eventos recentes */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold text-gray-900">Eventos recentes</h2>
        {recentTimeline.length === 0 ? (
          <p className="text-sm text-gray-400">Sem eventos.</p>
        ) : (
          <ul className="space-y-2">
            {recentTimeline.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                <div>
                  <p className="text-gray-800">{e.summary}</p>
                  <p className="text-xs text-gray-400">
                    {e.actor} ·{" "}
                    {new Date(e.createdAt).toLocaleString("pt-BR")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
