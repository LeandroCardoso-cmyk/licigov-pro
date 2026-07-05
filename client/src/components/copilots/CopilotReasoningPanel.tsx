import React from "react";
import { trpc } from "../../lib/trpc";

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

interface TraceStep {
  order: number;
  type: string;
  summary: string;
  evidenceCount: number;
}

function toSteps(raw: unknown): TraceStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      order: typeof s.order === "number" ? s.order : 0,
      type: typeof s.type === "string" ? s.type : "reasoning",
      summary: typeof s.summary === "string" ? s.summary : "",
      evidenceCount: typeof s.evidenceCount === "number" ? s.evidenceCount : 0,
    }));
}

interface CopilotReasoningPanelProps {
  sessionId?: string;
}

export default function CopilotReasoningPanel({ sessionId = "" }: CopilotReasoningPanelProps) {
  const query = trpc.copilot.getReasoning.useQuery(
    { sessionId },
    { enabled: sessionId !== "" },
  );

  const steps = toSteps(query.data?.trace?.steps);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Cadeia de Raciocínio</h2>

      {sessionId === "" ? (
        <p className="text-sm text-gray-400">Selecione uma sessão para visualizar o raciocínio.</p>
      ) : query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : steps.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma etapa de raciocínio registrada para esta sessão.</p>
      ) : (
        <ol className="space-y-3">
          {[...steps]
            .sort((a, b) => a.order - b.order)
            .map((step) => (
              <li
                key={step.order}
                className="flex gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                  {step.order + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {STEP_LABEL[step.type] ?? step.type}
                  </p>
                  <p className="text-sm text-gray-600">{step.summary}</p>
                  <p className="mt-1 text-xs text-gray-400">{step.evidenceCount} evidências</p>
                </div>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}
