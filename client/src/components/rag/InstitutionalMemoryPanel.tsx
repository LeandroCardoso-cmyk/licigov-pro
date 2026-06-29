import { useState, useEffect } from "react";

interface KnowledgeSource {
  id: string;
  name: string;
  type: string;
  evidenceCount: number;
  lastUpdated: string;
  status: "active" | "indexing" | "stale";
}

const mockSources: KnowledgeSource[] = [
  { id: "ks1", name: "Termos de Referência", type: "tr", evidenceCount: 156, lastUpdated: "2025-06-28", status: "active" },
  { id: "ks2", name: "Lei 14.133/2021", type: "legislation", evidenceCount: 218, lastUpdated: "2025-06-25", status: "active" },
  { id: "ks3", name: "DFDs Anteriores", type: "dfd", evidenceCount: 89, lastUpdated: "2025-06-20", status: "active" },
  { id: "ks4", name: "ETPs Anteriores", type: "etp", evidenceCount: 67, lastUpdated: "2025-06-18", status: "stale" },
  { id: "ks5", name: "Templates Municipais", type: "template", evidenceCount: 34, lastUpdated: "2025-06-15", status: "active" },
  { id: "ks6", name: "CATMAT/CATSER", type: "catalog", evidenceCount: 0, lastUpdated: "2025-06-01", status: "indexing" },
];

const typeColors: Record<string, string> = {
  tr: "bg-blue-100 text-blue-800",
  legislation: "bg-amber-100 text-amber-800",
  dfd: "bg-green-100 text-green-800",
  etp: "bg-purple-100 text-purple-800",
  template: "bg-indigo-100 text-indigo-800",
  catalog: "bg-teal-100 text-teal-800",
};

const statusIcons: Record<string, { color: string; label: string }> = {
  active: { color: "bg-green-500", label: "Ativo" },
  indexing: { color: "bg-blue-500 animate-pulse", label: "Indexando" },
  stale: { color: "bg-yellow-500", label: "Desatualizado" },
};

export default function InstitutionalMemoryPanel() {
  const [loading, setLoading] = useState(true);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-gray-200 rounded" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">Memória Institucional</h2>
      <div className="text-sm text-gray-500">
        {mockSources.length} fontes de conhecimento | {mockSources.reduce((s, k) => s + k.evidenceCount, 0)} evidências indexadas
      </div>
      <div className="space-y-3">
        {mockSources.map((src) => (
          <div key={src.id} className="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${statusIcons[src.status].color}`} />
              <div>
                <div className="text-sm font-medium text-gray-900">{src.name}</div>
                <div className="flex gap-2 mt-0.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${typeColors[src.type] ?? "bg-gray-100 text-gray-800"}`}>{src.type}</span>
                  <span className="text-xs text-gray-400">{statusIcons[src.status].label}</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-gray-700">{src.evidenceCount}</div>
              <div className="text-xs text-gray-400">Atualizado: {src.lastUpdated}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
