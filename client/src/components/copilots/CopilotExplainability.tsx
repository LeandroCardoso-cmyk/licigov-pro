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

interface CopilotExplainabilityProps {
  sessionId?: string;
}

export default function CopilotExplainability({ sessionId = "" }: CopilotExplainabilityProps) {
  const query = trpc.copilot.explainRecommendation.useQuery(
    { sessionId },
    { enabled: sessionId !== "" },
  );

  const steps = toSteps(query.data?.trace?.steps);
  const recommendations = query.data?.recommendations ?? [];

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">Explicabilidade</h2>

      {sessionId === "" ? (
        <p className="text-sm text-gray-400">Selecione uma sessão para explicar a recomendação.</p>
      ) : query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-800">Etapas do raciocínio</h3>
            {steps.length === 0 ? (
              <p className="text-sm text-gray-400">Sem trilha de raciocínio registrada.</p>
            ) : (
              <ol className="space-y-2">
                {[...steps]
                  .sort((a, b) => a.order - b.order)
                  .map((step) => (
                    <li key={step.order} className="rounded-md bg-gray-50 p-2 text-sm">
                      <span className="font-medium text-gray-800">
                        {STEP_LABEL[step.type] ?? step.type}:
                      </span>{" "}
                      <span className="text-gray-600">{step.summary}</span>
                    </li>
                  ))}
              </ol>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-800">Recomendações e justificativas</h3>
            {recommendations.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma recomendação registrada.</p>
            ) : (
              <ul className="space-y-3">
                {recommendations.map((rec, i) => (
                  <li key={i} className="rounded-md border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-800">{rec.summary}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      <span className="font-semibold">Tipo:</span> {rec.kind}
                      {" · "}
                      <span className="font-semibold">Confiança:</span>{" "}
                      {Math.round(rec.confidence * 100)}%
                      {rec.requiresHumanReview ? " · Revisão humana obrigatória" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
