import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * ProcessoLicitatorioHome — REAL (wired to tRPC).
 *
 * UX: esta é a porta de entrada do domínio Processo Licitatório.
 * A experiência é baseada em REVISÃO/validação, nunca em grandes formulários:
 * o operador escolhe um processo (card) e passa a validar recomendações do servidor.
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

const PROCESS_STATUS_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  em_andamento: "Em andamento",
  em_revisao: "Em revisão",
  emitido: "Emitido",
  arquivado: "Arquivado",
};

export type ProcessoLicitatorioHomeProps = {
  /** Callback ao clicar em "Novo Processo". */
  onCreateProcess?: () => void;
  /** Callback ao abrir um processo existente. */
  onOpenProcess?: (processId: string) => void;
};

export default function ProcessoLicitatorioHome({
  onCreateProcess,
  onOpenProcess,
}: ProcessoLicitatorioHomeProps) {
  const { data, isLoading } = trpc.procurementProcess.listProcesses.useQuery({
    limit: 50,
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Processos Licitatórios
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Fluxo DFD → ETP → TR → Edital. Você valida recomendações; o sistema
            estrutura a contratação.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateProcess}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          + Novo Processo
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-gray-200 bg-white p-5"
            >
              <div className="mb-3 h-4 w-24 rounded bg-gray-200" />
              <div className="mb-2 h-3 w-full rounded bg-gray-100" />
              <div className="mb-4 h-3 w-2/3 rounded bg-gray-100" />
              <div className="h-5 w-20 rounded-full bg-gray-200" />
            </div>
          ))}
        </div>
      ) : !data || data.processes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-gray-500">Nenhum processo cadastrado ainda.</p>
          <button
            type="button"
            onClick={onCreateProcess}
            className="mt-3 text-sm font-medium text-blue-600 hover:underline"
          >
            Criar o primeiro processo
          </button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-gray-400">
            {data.total} processo(s) encontrado(s)
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.processes.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProcess?.(p.id)}
                className="rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300 hover:shadow"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-gray-900">
                    {p.processNumber}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      PROCESS_STATUS_CLASSES[p.status] ??
                      "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {PROCESS_STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </div>
                <p className="mb-4 line-clamp-2 text-sm text-gray-600">
                  {p.object}
                </p>
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                    {STAGE_LABELS[p.currentStage] ?? p.currentStage}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(p.updatedAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
