import { useState, useEffect } from "react";

interface ReplayData {
  replayKey: string;
  originalSnapshot: string;
  replayedSnapshot: string;
  verified: boolean;
  deterministic: boolean;
  matchPercentage: number;
}

const mockReplay: ReplayData = {
  replayKey: "a3f8c2d1e5b7094f",
  originalSnapshot: JSON.stringify({
    query: "Elaborar ETP para aquisição de computadores",
    organizationId: 1,
    intent: "tr_generation",
    queryType: "generative",
    contextStrategy: "full_context",
    retrievalStrategy: "hybrid",
  }, null, 2),
  replayedSnapshot: JSON.stringify({
    query: "Elaborar ETP para aquisição de computadores",
    organizationId: 1,
    intent: "tr_generation",
    queryType: "generative",
    contextStrategy: "full_context",
    retrievalStrategy: "hybrid",
  }, null, 2),
  verified: true,
  deterministic: true,
  matchPercentage: 100,
};

export default function ReplayGroundingViewer() {
  const [loading, setLoading] = useState(true);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-40 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Replay Viewer</h2>
        <div className="flex gap-2">
          {mockReplay.verified ? (
            <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">Verificado</span>
          ) : (
            <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Divergência</span>
          )}
          {mockReplay.deterministic && (
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">Determinístico</span>
          )}
        </div>
      </div>

      <div className="bg-gray-50 border rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">Replay Key</span>
          <code className="text-xs font-mono bg-gray-200 px-2 py-0.5 rounded">{mockReplay.replayKey}</code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Match:</span>
          <div className="flex-1 bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${mockReplay.matchPercentage}%` }} />
          </div>
          <span className="text-sm font-medium text-green-600">{mockReplay.matchPercentage}%</span>
        </div>
      </div>

      <button onClick={() => setShowDiff(!showDiff)} className="text-sm text-blue-600 hover:underline">
        {showDiff ? "Ocultar" : "Ver"} Snapshots
      </button>

      {showDiff && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">Original</h3>
            <pre className="bg-gray-50 border rounded p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-60 overflow-y-auto">
              {mockReplay.originalSnapshot}
            </pre>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">Replay</h3>
            <pre className="bg-gray-50 border rounded p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-60 overflow-y-auto">
              {mockReplay.replayedSnapshot}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
