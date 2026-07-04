import React, { useState, useEffect } from "react";

interface PathStep {
  node: string;
  edgeType: string;
}

interface Recommendation {
  id: string;
  title: string;
  score: number;
  path: PathStep[];
  reason: string;
  confidence: "high" | "medium" | "low";
}

const mockRecommendations: Recommendation[] = [
  {
    id: "rec-1",
    title: "Pregão Eletrônico - Material de Escritório",
    score: 0.94,
    path: [
      { node: "DFD-2024/0012", edgeType: "originou" },
      { node: "ETP-2024/0012", edgeType: "referencia" },
      { node: "TR-2024/0008", edgeType: "" },
    ],
    reason: "Processo similar com mesma natureza de objeto e faixa de valor estimado.",
    confidence: "high",
  },
  {
    id: "rec-2",
    title: "Dispensa por Valor - Serviços de TI",
    score: 0.87,
    path: [
      { node: "Fornecedor-ABC", edgeType: "atende" },
      { node: "CATSER-25631", edgeType: "classifica" },
      { node: "TR-2024/0015", edgeType: "" },
    ],
    reason: "Fornecedor com histórico positivo na mesma categoria de serviço.",
    confidence: "high",
  },
  {
    id: "rec-3",
    title: "Concorrência - Obras de Engenharia",
    score: 0.76,
    path: [
      { node: "ETP-2023/0045", edgeType: "similar_a" },
      { node: "Edital-2023/0045", edgeType: "" },
    ],
    reason: "ETP com escopo técnico e requisitos de habilitação compatíveis.",
    confidence: "medium",
  },
  {
    id: "rec-4",
    title: "Ata de Registro de Preços - Combustíveis",
    score: 0.71,
    path: [
      { node: "ARP-2024/0003", edgeType: "vigente_para" },
      { node: "Órgão-Municipal", edgeType: "participa" },
      { node: "CATMAT-46101", edgeType: "" },
    ],
    reason: "Ata vigente com saldo disponível para adesão pelo órgão.",
    confidence: "medium",
  },
  {
    id: "rec-5",
    title: "Inexigibilidade - Treinamento Especializado",
    score: 0.58,
    path: [
      { node: "Parecer-2024/0021", edgeType: "fundamenta" },
      { node: "Art75-Lei14133", edgeType: "" },
    ],
    reason: "Parecer jurídico anterior com fundamentação aplicável ao caso.",
    confidence: "low",
  },
  {
    id: "rec-6",
    title: "Pregão Eletrônico - Equipamentos Médicos",
    score: 0.52,
    path: [
      { node: "DFD-2024/0034", edgeType: "demanda" },
      { node: "Setor-Saúde", edgeType: "requer" },
      { node: "CATMAT-65015", edgeType: "" },
    ],
    reason: "Demanda recorrente do setor com especificações padronizadas.",
    confidence: "low",
  },
];

const confidenceColors: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-red-100 text-red-800",
};

function RecommendationExplorer() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setRecommendations([...mockRecommendations].sort((a, b) => b.score - a.score));
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg border p-4">
            <div className="mb-2 h-5 w-2/3 rounded bg-gray-200" />
            <div className="mb-2 h-3 w-full rounded bg-gray-100" />
            <div className="h-3 w-1/2 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  const renderPath = (path: PathStep[]): string => {
    return path
      .map((step, idx) => (idx < path.length - 1 ? `${step.node} -> [${step.edgeType}]` : step.node))
      .join(" -> ");
  };

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-bold text-gray-800">Recomendações do Grafo</h2>
      {recommendations.map((rec) => (
        <div key={rec.id} className="rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-gray-900">{rec.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceColors[rec.confidence]}`}>
              {rec.confidence}
            </span>
          </div>
          <div className="mb-2">
            <div className="h-2 w-full rounded-full bg-gray-200">
              <div
                className="h-2 rounded-full bg-blue-500"
                style={{ width: `${rec.score * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{(rec.score * 100).toFixed(0)}%</span>
          </div>
          <p className="mb-1 font-mono text-xs text-gray-500">{renderPath(rec.path)}</p>
          <p className="text-sm text-gray-600">{rec.reason}</p>
        </div>
      ))}
    </div>
  );
}

export default RecommendationExplorer;
