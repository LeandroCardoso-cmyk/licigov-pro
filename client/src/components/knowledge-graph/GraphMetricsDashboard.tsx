import React, { useState, useEffect } from "react";

interface GraphMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  icon: string;
  color: string;
}

interface MetricsData {
  totalNodes: number;
  totalEdges: number;
  orphanNodes: number;
  averageDegree: number;
  healthScore: number;
  traversalLatency: number;
  resolutions: number;
}

const mockMetrics: MetricsData = {
  totalNodes: 1247,
  totalEdges: 3891,
  orphanNodes: 12,
  averageDegree: 3.12,
  healthScore: 87,
  traversalLatency: 45,
  resolutions: 156,
};

function getHealthColor(score: number): string {
  if (score > 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function getHealthBg(score: number): string {
  if (score > 80) return "bg-green-100";
  if (score >= 60) return "bg-yellow-100";
  return "bg-red-100";
}

function GraphMetricsDashboard() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMetrics(mockMetrics);
      setLoading(false);
    }, 700);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg border p-4 shadow-sm">
            <div className="mb-2 h-4 w-1/2 rounded bg-gray-200" />
            <div className="h-8 w-2/3 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  if (!metrics) return null;

  const cards: GraphMetric[] = [
    { id: "nodes", label: "Total de Nós", value: metrics.totalNodes, unit: "", icon: "⬡", color: "text-blue-600" },
    { id: "edges", label: "Total de Arestas", value: metrics.totalEdges, unit: "", icon: "⟷", color: "text-indigo-600" },
    {
      id: "orphans",
      label: "Nós Órfãos",
      value: metrics.orphanNodes,
      unit: "",
      icon: "⚠",
      color: metrics.orphanNodes > 0 ? "text-orange-600" : "text-gray-600",
    },
    { id: "degree", label: "Grau Médio", value: metrics.averageDegree, unit: "", icon: "◈", color: "text-purple-600" },
    {
      id: "health",
      label: "Saúde do Grafo",
      value: metrics.healthScore,
      unit: "%",
      icon: "♥",
      color: getHealthColor(metrics.healthScore),
    },
    { id: "latency", label: "Latência de Traversal", value: metrics.traversalLatency, unit: "ms", icon: "⚡", color: "text-cyan-600" },
    { id: "resolutions", label: "Resoluções", value: metrics.resolutions, unit: "", icon: "✓", color: "text-green-600" },
  ];

  return (
    <div className="p-4">
      <h2 className="mb-4 text-lg font-bold text-gray-800">Métricas do Grafo</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.id}
            className={`rounded-lg border border-gray-200 p-4 shadow-sm ${
              card.id === "health" ? getHealthBg(metrics.healthScore) : ""
            } ${card.id === "orphans" && metrics.orphanNodes > 0 ? "border-orange-300 bg-orange-50" : ""}`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-lg">{card.icon}</span>
              <span className="text-sm text-gray-600">{card.label}</span>
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>
              {card.id === "degree" ? card.value.toFixed(2) : card.value.toLocaleString("pt-BR")}
              {card.unit && <span className="ml-1 text-sm font-normal text-gray-500">{card.unit}</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default GraphMetricsDashboard;
