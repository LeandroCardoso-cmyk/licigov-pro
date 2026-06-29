import { useState, useEffect } from "react";

interface PipelineStage {
  name: string;
  status: "completed" | "running" | "pending";
  durationMs: number;
  chunkCount: number;
  evidenceCount: number;
}

const mockStages: PipelineStage[] = [
  { name: "Retrieval", status: "completed", durationMs: 45, chunkCount: 12, evidenceCount: 0 },
  { name: "Evidence Selection", status: "completed", durationMs: 18, chunkCount: 12, evidenceCount: 8 },
  { name: "Context Assembly", status: "completed", durationMs: 22, chunkCount: 8, evidenceCount: 8 },
  { name: "Grounding", status: "completed", durationMs: 35, chunkCount: 8, evidenceCount: 6 },
  { name: "Citation", status: "completed", durationMs: 12, chunkCount: 6, evidenceCount: 6 },
  { name: "Validation", status: "completed", durationMs: 8, chunkCount: 6, evidenceCount: 6 },
];

const statusColors = {
  completed: "bg-green-500",
  running: "bg-blue-500 animate-pulse",
  pending: "bg-gray-300",
};

export default function ExplainabilityTimeline() {
  const [loading, setLoading] = useState(true);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 bg-gray-200 rounded" />)}
      </div>
    );
  }

  const totalMs = mockStages.reduce((s, st) => s + st.durationMs, 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Pipeline RAG</h2>
        <span className="text-sm text-gray-500">Total: {totalMs}ms</span>
      </div>
      <div className="space-y-3">
        {mockStages.map((stage, i) => (
          <div key={stage.name} className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full ${statusColors[stage.status]}`} />
              {i < mockStages.length - 1 && <div className="w-0.5 h-8 bg-gray-300" />}
            </div>
            <div className="flex-1 border border-gray-200 rounded-lg p-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-900">{stage.name}</span>
                <span className="text-xs text-gray-500">{stage.durationMs}ms</span>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                <span>Chunks: {stage.chunkCount}</span>
                <span>Evidências: {stage.evidenceCount}</span>
              </div>
              <div className="mt-1 w-full bg-gray-100 rounded-full h-1">
                <div className="bg-blue-400 h-1 rounded-full" style={{ width: `${(stage.durationMs / totalMs) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
