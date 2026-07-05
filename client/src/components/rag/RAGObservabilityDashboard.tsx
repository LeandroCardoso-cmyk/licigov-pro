import { useState, useEffect } from "react";

interface MetricCard {
  label: string;
  value: string;
  unit: string;
  trend: "up" | "down" | "stable";
}

interface LatencyData {
  retrieval: number;
  grounding: number;
  inference: number;
  total: number;
}

const mockMetrics: MetricCard[] = [
  { label: "Latência Média", value: "142", unit: "ms", trend: "down" },
  { label: "Tokens Consumidos", value: "3.4k", unit: "tokens", trend: "stable" },
  { label: "Confiança Média", value: "84", unit: "%", trend: "up" },
  { label: "Citações/Resposta", value: "4.2", unit: "avg", trend: "up" },
];

const mockLatency: LatencyData = {
  retrieval: 45,
  grounding: 35,
  inference: 52,
  total: 142,
};

const riskDistribution = [
  { level: "none", count: 42, color: "bg-green-500" },
  { level: "low", count: 28, color: "bg-yellow-500" },
  { level: "medium", count: 8, color: "bg-orange-500" },
  { level: "high", count: 2, color: "bg-red-500" },
];

const trendIcons: Record<string, string> = { up: "↑", down: "↓", stable: "→" };
const trendColors: Record<string, string> = { up: "text-green-600", down: "text-green-600", stable: "text-gray-500" };

export default function RAGObservabilityDashboard() {
  const [loading, setLoading] = useState(true);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-gray-200 rounded" />)}</div>
      </div>
    );
  }

  const totalRisk = riskDistribution.reduce((s, r) => s + r.count, 0);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Observabilidade RAG</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {mockMetrics.map((m) => (
          <div key={m.label} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">{m.label}</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-bold text-gray-900">{m.value}</span>
              <span className="text-xs text-gray-400">{m.unit}</span>
            </div>
            <span className={`text-xs ${trendColors[m.trend]}`}>{trendIcons[m.trend]} {m.trend}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Latência por Estágio</h3>
          {Object.entries(mockLatency).filter(([k]) => k !== "total").map(([key, value]) => (
            <div key={key} className="mb-2">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600 capitalize">{key}</span>
                <span className="font-mono text-gray-800">{value}ms</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(value / mockLatency.total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Distribuição de Risco</h3>
          {riskDistribution.map((r) => (
            <div key={r.level} className="flex items-center gap-2 mb-2">
              <div className={`w-3 h-3 rounded-full ${r.color}`} />
              <span className="text-sm text-gray-600 w-16 capitalize">{r.level}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div className={`${r.color} h-2 rounded-full`} style={{ width: `${(r.count / totalRisk) * 100}%` }} />
              </div>
              <span className="text-xs font-mono text-gray-500 w-8 text-right">{r.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
