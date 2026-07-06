import React from "react";

export interface WorkspaceEvidence {
  id: string;
  label: string;
  source: string;
}

export interface WorkspaceContext {
  documents: string[];
  evidences: WorkspaceEvidence[];
  graphNodeIds: string[];
  memorySummary: string;
}

interface WorkspaceContextPanelProps {
  context?: WorkspaceContext;
}

const DEFAULT_CONTEXT: WorkspaceContext = {
  documents: ["DFD-2026-001", "ETP-2026-001", "TR-2026-001"],
  evidences: [
    { id: "e1", label: "Cotação Fornecedor A", source: "pesquisa_precos" },
    { id: "e2", label: "Item CATMAT 4567", source: "catmat" },
    { id: "e3", label: "Art. 18, Lei 14.133/2021", source: "rag_legal" },
  ],
  graphNodeIds: ["n-processo", "n-demanda", "n-orcamento"],
  memorySummary:
    "Contratação de serviços de manutenção predial em andamento; ETP concluído e pesquisa de preços validada.",
};

export default function WorkspaceContextPanel({
  context = DEFAULT_CONTEXT,
}: WorkspaceContextPanelProps) {
  const counts = [
    { label: "Documentos", value: context.documents.length },
    { label: "Evidências", value: context.evidences.length },
    { label: "Nós do Grafo", value: context.graphNodeIds.length },
  ];

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Contexto do Espaço
      </h2>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {counts.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-gray-200 bg-white p-3 text-center"
          >
            <p className="text-2xl font-semibold text-gray-900">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-lg bg-gray-50 p-3">
        <p className="mb-1 text-xs font-semibold uppercase text-gray-400">
          Memória Consolidada
        </p>
        <p className="text-sm text-gray-700">{context.memorySummary}</p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-gray-400">
          Evidências
        </p>
        <ul className="space-y-2">
          {context.evidences.map((ev) => (
            <li
              key={ev.id}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <span className="text-gray-800">{ev.label}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {ev.source}
              </span>
            </li>
          ))}
          {context.evidences.length === 0 && (
            <li className="text-sm text-gray-400">Nenhuma evidência.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
