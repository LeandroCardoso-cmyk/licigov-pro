import React from "react";

export interface RecommendationRisk {
  description: string;
  severity: "baixo" | "medio" | "alto" | "critico";
  mitigation: string;
}

export interface RecommendationAlternative {
  description: string;
  rationale: string;
}

export interface Recommendation {
  summary: string;
  suggestions: string[];
  risks: RecommendationRisk[];
  alternatives: RecommendationAlternative[];
  legalBasis: string[];
  confidence: number;
  reviewNotice: string;
  requiresHumanReview: boolean;
}

const RISK_COLOR: Record<RecommendationRisk["severity"], string> = {
  baixo: "bg-green-100 text-green-700 border-green-200",
  medio: "bg-yellow-100 text-yellow-700 border-yellow-200",
  alto: "bg-orange-100 text-orange-700 border-orange-200",
  critico: "bg-red-100 text-red-700 border-red-200",
};

const RISK_LABEL: Record<RecommendationRisk["severity"], string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
  critico: "Crítico",
};

const DEFAULT_RECOMMENDATION: Recommendation = {
  summary:
    "Recomenda-se estruturar a contratação por pregão eletrônico, com fundamentação no interesse público e economicidade.",
  suggestions: [
    "Detalhar o objeto no Termo de Referência com base no CATMAT.",
    "Realizar ampla pesquisa de preços em ao menos três fontes.",
    "Incluir critérios objetivos de julgamento no edital.",
  ],
  risks: [
    { description: "Pesquisa de preços insuficiente.", severity: "alto", mitigation: "Ampliar fontes consultadas." },
    { description: "Objeto genérico no TR.", severity: "medio", mitigation: "Especificar item a item." },
  ],
  alternatives: [
    { description: "Contratação direta por dispensa.", rationale: "Aplicável se dentro dos limites do art. 75." },
  ],
  legalBasis: ["Lei 14.133/2021, art. 6º, XXIII", "Lei 14.133/2021, art. 18", "Lei 14.133/2021, art. 23"],
  confidence: 0.78,
  reviewNotice:
    "Esta recomendação é um apoio técnico gerado por IA. Deve ser revisada e validada por servidor competente antes de qualquer uso.",
  requiresHumanReview: true,
};

interface RecommendationPanelProps {
  recommendation?: Recommendation;
}

export default function RecommendationPanel({
  recommendation = DEFAULT_RECOMMENDATION,
}: RecommendationPanelProps) {
  const confidencePct = Math.round(Math.max(0, Math.min(1, recommendation.confidence)) * 100);

  return (
    <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Recomendação</h2>
        <p className="mt-1 text-sm text-gray-700">{recommendation.summary}</p>
      </div>

      <div>
        <p className="mb-1 flex items-center justify-between text-xs font-medium text-gray-500">
          <span>Confiança</span>
          <span>{confidencePct}%</span>
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${confidencePct}%` }} />
        </div>
      </div>

      {recommendation.suggestions.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Sugestões</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {recommendation.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {recommendation.risks.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Riscos</h3>
          <ul className="space-y-2">
            {recommendation.risks.map((r, i) => (
              <li key={i} className={`rounded-md border p-3 ${RISK_COLOR[r.severity]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{r.description}</span>
                  <span className="shrink-0 rounded-full bg-white/60 px-2 py-0.5 text-xs font-semibold">
                    {RISK_LABEL[r.severity]}
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-80">Mitigação: {r.mitigation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommendation.alternatives.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Alternativas</h3>
          <ul className="space-y-2">
            {recommendation.alternatives.map((a, i) => (
              <li key={i} className="rounded-md bg-gray-50 p-3 text-sm">
                <p className="font-medium text-gray-800">{a.description}</p>
                <p className="text-xs text-gray-500">{a.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommendation.legalBasis.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Fundamentação Legal</h3>
          <div className="flex flex-wrap gap-2">
            {recommendation.legalBasis.map((b, i) => (
              <span
                key={i}
                className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {recommendation.requiresHumanReview && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">⚠️ Revisão obrigatória</p>
          <p className="mt-1 text-xs text-amber-700">{recommendation.reviewNotice}</p>
        </div>
      )}
    </div>
  );
}
