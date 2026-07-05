import React from "react";

export interface TraceStep {
  order: number;
  type: string;
  summary: string;
  evidenceCount: number;
}

const STEP_LABEL: Record<string, string> = {
  intent_classification: "Classificação de Intenção",
  copilot_selection: "Seleção de Copiloto",
  knowledge_graph: "Grafo de Conhecimento",
  institutional_rag: "RAG Institucional",
  context_assembly: "Montagem de Contexto",
  reasoning: "Raciocínio",
  recommendation: "Recomendação",
  validation: "Validação",
  explainability: "Explicabilidade",
};

const DEFAULT_STEPS: TraceStep[] = [
  { order: 0, type: "intent_classification", summary: "Intenção identificada: estruturação de contratação.", evidenceCount: 1 },
  { order: 1, type: "copilot_selection", summary: "Copiloto Agente de Contratação selecionado.", evidenceCount: 0 },
  { order: 2, type: "institutional_rag", summary: "Recuperados trechos da Lei 14.133/2021.", evidenceCount: 4 },
  { order: 3, type: "context_assembly", summary: "Contexto consolidado com evidências institucionais.", evidenceCount: 4 },
  { order: 4, type: "reasoning", summary: "Raciocínio sobre modalidade e fundamentação.", evidenceCount: 2 },
  { order: 5, type: "recommendation", summary: "Recomendação de pregão eletrônico emitida.", evidenceCount: 3 },
  { order: 6, type: "validation", summary: "Política aplicada; revisão humana exigida.", evidenceCount: 0 },
];

interface DecisionTraceViewerProps {
  steps?: TraceStep[];
}

export default function DecisionTraceViewer({ steps = DEFAULT_STEPS }: DecisionTraceViewerProps) {
  const ordered = [...steps].sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Trilha de Decisão</h2>
      {ordered.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma etapa registrada.</p>
      ) : (
        <ol className="relative border-l border-gray-200 pl-6">
          {ordered.map((step) => (
            <li key={step.order} className="mb-6 last:mb-0">
              <span className="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-indigo-500" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-indigo-600">#{step.order + 1}</span>
                <span className="text-sm font-medium text-gray-800">
                  {STEP_LABEL[step.type] ?? step.type}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{step.summary}</p>
              <p className="mt-1 text-xs text-gray-400">{step.evidenceCount} evidências</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
