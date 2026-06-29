import { useState, useEffect } from "react";

interface Evidence {
  id: string;
  content: string;
  source: string;
  score: number;
  confidence: number;
  type: string;
  hasContradiction: boolean;
}

const mockEvidence: Evidence[] = [
  { id: "ev1", content: "A Lei 14.133/2021 exige estudo técnico preliminar para contratações acima do limite.", score: 0.95, confidence: 0.92, type: "legal", source: "Lei 14.133/2021", hasContradiction: false },
  { id: "ev2", content: "O Decreto 11.462/2023 regulamenta os procedimentos auxiliares.", score: 0.88, confidence: 0.85, type: "legal", source: "Decreto 11.462/2023", hasContradiction: false },
  { id: "ev3", content: "TR anterior utilizou especificação técnica detalhada para equipamentos.", score: 0.82, confidence: 0.78, type: "document", source: "TR-2024-0042", hasContradiction: false },
  { id: "ev4", content: "Jurisprudência do TCU recomenda pesquisa ampla de preços.", score: 0.75, confidence: 0.70, type: "jurisprudence", source: "TCU", hasContradiction: true },
];

const typeColors: Record<string, string> = {
  legal: "bg-amber-100 text-amber-800",
  document: "bg-blue-100 text-blue-800",
  jurisprudence: "bg-purple-100 text-purple-800",
  template: "bg-green-100 text-green-800",
};

export default function RetrievalEvidenceViewer() {
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-200 rounded" />)}
        </div>
      </div>
    );
  }

  const filtered = filter === "all" ? mockEvidence : mockEvidence.filter((e) => e.type === filter);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">Evidências Recuperadas</h2>
      <div className="flex gap-2">
        {["all", "legal", "document", "jurisprudence"].map((t) => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1 rounded text-xs font-medium ${filter === t ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >{t === "all" ? "Todos" : t}</button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.map((ev) => (
          <div key={ev.id} className={`border rounded-lg p-4 ${ev.hasContradiction ? "border-red-300 bg-red-50" : "border-gray-200"}`}>
            <div className="flex justify-between items-start mb-2">
              <span className={`px-2 py-0.5 rounded text-xs ${typeColors[ev.type] ?? "bg-gray-100 text-gray-800"}`}>{ev.type}</span>
              {ev.hasContradiction && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs">Contradição</span>}
            </div>
            <p className="text-sm text-gray-800 mb-3">{ev.content}</p>
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="text-xs text-gray-500 mb-1">Score: {ev.score.toFixed(2)}</div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${ev.score * 100}%` }} />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-500 mb-1">Confiança: {ev.confidence.toFixed(2)}</div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${ev.confidence * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
