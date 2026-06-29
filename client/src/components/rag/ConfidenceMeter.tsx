import { useState, useEffect } from "react";

interface ConfidenceData {
  retrieval: number;
  evidence: number;
  legal: number;
  grounding: number;
  response: number;
  consolidated: number;
}

const mockConfidence: ConfidenceData = {
  retrieval: 0.88,
  evidence: 0.82,
  legal: 0.91,
  grounding: 0.79,
  response: 0.85,
  consolidated: 0.85,
};

function getColor(value: number): string {
  if (value > 0.8) return "text-green-600";
  if (value > 0.6) return "text-yellow-600";
  if (value > 0.4) return "text-orange-600";
  return "text-red-600";
}

function getBgColor(value: number): string {
  if (value > 0.8) return "bg-green-500";
  if (value > 0.6) return "bg-yellow-500";
  if (value > 0.4) return "bg-orange-500";
  return "bg-red-500";
}

function getRingColor(value: number): string {
  if (value > 0.8) return "stroke-green-500";
  if (value > 0.6) return "stroke-yellow-500";
  if (value > 0.4) return "stroke-orange-500";
  return "stroke-red-500";
}

const dimensionLabels: Record<string, string> = {
  retrieval: "Recuperação",
  evidence: "Evidência",
  legal: "Jurídica",
  grounding: "Grounding",
  response: "Resposta",
};

const dimensionWeights: Record<string, number> = {
  retrieval: 0.25,
  evidence: 0.25,
  legal: 0.20,
  grounding: 0.15,
  response: 0.15,
};

export default function ConfidenceMeter() {
  const [loading, setLoading] = useState(true);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-40 bg-gray-200 rounded-full w-40 mx-auto" />
      </div>
    );
  }

  const circumference = 2 * Math.PI * 45;
  const offset = circumference * (1 - mockConfidence.consolidated);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Confiança</h2>
      <div className="flex justify-center">
        <div className="relative w-36 h-36">
          <svg className="w-36 h-36 transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" strokeWidth="8" />
            <circle cx="50" cy="50" r="45" fill="none" className={getRingColor(mockConfidence.consolidated)}
              strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${getColor(mockConfidence.consolidated)}`}>
              {(mockConfidence.consolidated * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-gray-500">Consolidada</span>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {Object.entries(dimensionLabels).map(([key, label]) => {
          const value = mockConfidence[key as keyof ConfidenceData] as number;
          return (
            <div key={key}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">{label}</span>
                <div className="flex gap-2">
                  <span className="text-xs text-gray-400">peso: {((dimensionWeights[key] ?? 0) * 100).toFixed(0)}%</span>
                  <span className={`font-medium ${getColor(value)}`}>{(value * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className={`h-2 rounded-full ${getBgColor(value)}`} style={{ width: `${value * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
