import { useState, useEffect } from "react";

interface EvidenceNode {
  id: string;
  type: string;
  content: string;
  confidence: number;
  source: string;
}

interface EvidenceEdge {
  from: string;
  to: string;
  relationship: string;
}

interface GroundingData {
  id: string;
  groundingScore: number;
  confidenceScore: number;
  correlationId: string;
  replaySnapshot: string;
  finalPrompt: string;
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
}

const mockGrounding: GroundingData = {
  id: "gs_001",
  groundingScore: 0.87,
  confidenceScore: 0.84,
  correlationId: "corr-47-001",
  replaySnapshot: '{"query":"consulta licitatória","orgId":1,"intent":"legal_consultation"}',
  finalPrompt: "=== CONTEXTO INSTITUCIONAL ===\nOrganização Municipal de Licitações\n\n=== LEGISLAÇÃO ===\nLei 14.133/2021, Art. 18\n\n=== CONSULTA ===\nElaborar estudo técnico preliminar...",
  nodes: [
    { id: "n1", type: "legal", content: "Art. 18 - ETP", confidence: 0.95, source: "Lei 14.133/2021" },
    { id: "n2", type: "document", content: "TR anterior similar", confidence: 0.82, source: "TR-2024-0042" },
    { id: "n3", type: "jurisprudence", content: "Acórdão TCU", confidence: 0.78, source: "TCU" },
  ],
  edges: [
    { from: "n1", to: "n2", relationship: "supports" },
    { from: "n1", to: "n3", relationship: "elaborates" },
  ],
};

const relColors: Record<string, string> = {
  supports: "text-green-600",
  contradicts: "text-red-600",
  elaborates: "text-blue-600",
  supersedes: "text-purple-600",
};

export default function GroundingExplorer() {
  const [loading, setLoading] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-60 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Grounding Explorer</h2>
        <span className="text-xs font-mono text-gray-400">{mockGrounding.correlationId}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{(mockGrounding.groundingScore * 100).toFixed(0)}%</div>
          <div className="text-xs text-blue-600">Grounding Score</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{(mockGrounding.confidenceScore * 100).toFixed(0)}%</div>
          <div className="text-xs text-green-600">Confidence Score</div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Grafo de Evidências</h3>
        <div className="space-y-2">
          {mockGrounding.nodes.map((n) => (
            <div key={n.id} className="border border-gray-200 rounded p-3 flex justify-between items-center">
              <div>
                <span className="text-sm font-medium text-gray-900">{n.content}</span>
                <div className="text-xs text-gray-500 mt-0.5">{n.source}</div>
              </div>
              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{(n.confidence * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1">
          {mockGrounding.edges.map((e, i) => (
            <div key={i} className="text-xs flex gap-1 items-center">
              <span className="font-mono">{e.from}</span>
              <span className={relColors[e.relationship] ?? "text-gray-600"}>→ {e.relationship} →</span>
              <span className="font-mono">{e.to}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <button onClick={() => setShowPrompt(!showPrompt)} className="text-sm text-blue-600 hover:underline">
          {showPrompt ? "Ocultar" : "Ver"} Prompt Final
        </button>
        {showPrompt && (
          <pre className="bg-gray-50 border rounded p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-60 overflow-y-auto">{mockGrounding.finalPrompt}</pre>
        )}
        <button onClick={() => setShowSnapshot(!showSnapshot)} className="text-sm text-blue-600 hover:underline block">
          {showSnapshot ? "Ocultar" : "Ver"} Replay Snapshot
        </button>
        {showSnapshot && (
          <pre className="bg-gray-50 border rounded p-3 text-xs text-gray-700 whitespace-pre-wrap">{JSON.stringify(JSON.parse(mockGrounding.replaySnapshot), null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
