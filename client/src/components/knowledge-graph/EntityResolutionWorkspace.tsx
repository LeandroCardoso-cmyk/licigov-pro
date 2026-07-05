import React, { useState, useEffect } from "react";

type ResolutionStrategy = "exact" | "fuzzy" | "alias" | "semantic";
type ResolutionStatus = "pending" | "resolved" | "conflict" | "rejected";

interface Entity {
  name: string;
  type: string;
}

interface EntityPair {
  id: string;
  entityA: Entity;
  entityB: Entity;
  similarityScore: number;
  strategy: ResolutionStrategy;
  status: ResolutionStatus;
}

const strategyColors: Record<ResolutionStrategy, string> = {
  exact: "bg-blue-100 text-blue-800",
  fuzzy: "bg-purple-100 text-purple-800",
  alias: "bg-green-100 text-green-800",
  semantic: "bg-orange-100 text-orange-800",
};

const statusColors: Record<ResolutionStatus, string> = {
  pending: "bg-gray-100 text-gray-700",
  resolved: "bg-green-100 text-green-700",
  conflict: "bg-yellow-100 text-yellow-700",
  rejected: "bg-red-100 text-red-700",
};

const mockPairs: EntityPair[] = [
  {
    id: "pair-1",
    entityA: { name: "Secretaria de Educação", type: "Órgão" },
    entityB: { name: "Sec. de Educação Municipal", type: "Órgão" },
    similarityScore: 92,
    strategy: "fuzzy",
    status: "pending",
  },
  {
    id: "pair-2",
    entityA: { name: "ABC Informática Ltda", type: "Fornecedor" },
    entityB: { name: "ABC Informática LTDA - ME", type: "Fornecedor" },
    similarityScore: 97,
    strategy: "exact",
    status: "resolved",
  },
  {
    id: "pair-3",
    entityA: { name: "Material de Limpeza", type: "Categoria" },
    entityB: { name: "Produtos de Higienização", type: "Categoria" },
    similarityScore: 78,
    strategy: "semantic",
    status: "conflict",
  },
  {
    id: "pair-4",
    entityA: { name: "João Silva", type: "Servidor" },
    entityB: { name: "J. Silva (Pregoeiro)", type: "Servidor" },
    similarityScore: 85,
    strategy: "alias",
    status: "pending",
  },
  {
    id: "pair-5",
    entityA: { name: "Pregão 2024/0015", type: "Processo" },
    entityB: { name: "PE 15/2024", type: "Processo" },
    similarityScore: 99,
    strategy: "alias",
    status: "rejected",
  },
];

const statusTabs: { label: string; value: ResolutionStatus | "all" }[] = [
  { label: "Todos", value: "all" },
  { label: "Pendentes", value: "pending" },
  { label: "Resolvidos", value: "resolved" },
  { label: "Conflitos", value: "conflict" },
  { label: "Rejeitados", value: "rejected" },
];

function EntityResolutionWorkspace() {
  const [pairs, setPairs] = useState<EntityPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ResolutionStatus | "all">("all");

  useEffect(() => {
    const timer = setTimeout(() => {
      setPairs(mockPairs);
      setLoading(false);
    }, 750);
    return () => clearTimeout(timer);
  }, []);

  const filtered = activeTab === "all" ? pairs : pairs.filter((p) => p.status === activeTab);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded bg-gray-200" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg border p-4">
            <div className="mb-2 h-5 w-3/4 rounded bg-gray-200" />
            <div className="h-4 w-1/2 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-lg font-bold text-gray-800">Resolução de Entidades</h2>
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.value ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.map((pair) => (
          <div key={pair.id} className="rounded-lg border border-gray-200 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <span className="font-medium text-gray-900">{pair.entityA.name}</span>
                  <span className="ml-1 text-xs text-gray-500">({pair.entityA.type})</span>
                </div>
                <span className="text-gray-400">↔</span>
                <div>
                  <span className="font-medium text-gray-900">{pair.entityB.name}</span>
                  <span className="ml-1 text-xs text-gray-500">({pair.entityB.type})</span>
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[pair.status]}`}>
                {pair.status}
              </span>
            </div>
            <div className="mb-2">
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div className="h-2 rounded-full bg-blue-500" style={{ width: `${pair.similarityScore}%` }} />
              </div>
              <span className="text-xs text-gray-500">{pair.similarityScore}% similaridade</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${strategyColors[pair.strategy]}`}>
                {pair.strategy}
              </span>
              {pair.status === "pending" && (
                <div className="flex gap-2">
                  <button className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700">
                    Resolver
                  </button>
                  <button className="rounded bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200">
                    Rejeitar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default EntityResolutionWorkspace;
