import { useState, useEffect } from "react";

interface AssemblyData {
  retrievedChunks: Array<{ chunkId: string; content: string; similarity: number; source: string }>;
  legalReferences: Array<{ lawRef: string; article: string; text: string }>;
  municipalityHistory: Array<{ processId: string; description: string; date: string }>;
  similarTRs: Array<{ trId: string; title: string; similarity: number }>;
  totalTokens: number;
  assemblyStrategy: string;
  compressionApplied: boolean;
}

const mockData: AssemblyData = {
  retrievedChunks: [
    { chunkId: "ch1", content: "Artigo 18 da Lei 14.133/2021 estabelece...", similarity: 0.92, source: "lei_14133" },
    { chunkId: "ch2", content: "Termo de Referência deve conter especificação...", similarity: 0.85, source: "tr_anterior" },
  ],
  legalReferences: [
    { lawRef: "Lei 14.133/2021", article: "Art. 18", text: "O estudo técnico preliminar..." },
  ],
  municipalityHistory: [
    { processId: "2024/0042", description: "Aquisição de equipamentos de TI", date: "2024-03-15" },
  ],
  similarTRs: [
    { trId: "tr1", title: "TR - Equipamentos de Informática", similarity: 0.88 },
  ],
  totalTokens: 3420,
  assemblyStrategy: "full_context",
  compressionApplied: false,
};

export default function ContextAssemblyViewer() {
  const [loading, setLoading] = useState(true);
  const [data] = useState<AssemblyData>(mockData);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-40 bg-gray-200 rounded w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Context Assembly</h2>
        <div className="flex gap-2">
          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">{data.assemblyStrategy}</span>
          <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs">{data.totalTokens} tokens</span>
          {data.compressionApplied && <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">Comprimido</span>}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Chunks Recuperados</h3>
        {data.retrievedChunks.map((c) => (
          <div key={c.chunkId} className="border-l-4 border-blue-400 pl-3 py-2 mb-2">
            <p className="text-sm text-gray-800">{c.content}</p>
            <div className="flex gap-2 mt-1">
              <span className="text-xs text-gray-500">{c.source}</span>
              <span className="text-xs text-green-600">sim: {c.similarity.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Referências Legais</h3>
        {data.legalReferences.map((r, i) => (
          <div key={i} className="border-l-4 border-amber-400 pl-3 py-2 mb-2">
            <p className="text-sm font-medium text-gray-900">{r.lawRef}, {r.article}</p>
            <p className="text-sm text-gray-600">{r.text}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">TRs Similares</h3>
        {data.similarTRs.map((t) => (
          <div key={t.trId} className="flex justify-between items-center border border-gray-200 rounded p-2 mb-1">
            <span className="text-sm text-gray-800">{t.title}</span>
            <span className="text-xs text-green-600">{(t.similarity * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
