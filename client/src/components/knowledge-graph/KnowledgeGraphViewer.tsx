import React, { useState, useEffect } from "react";

interface GraphNode {
  id: string;
  label: string;
  type: "processo" | "documento" | "entidade" | "conceito" | "norma";
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_COLORS: Record<GraphNode["type"], { bg: string; border: string; text: string }> = {
  processo: { bg: "bg-blue-50", border: "border-blue-400", text: "text-blue-700" },
  documento: { bg: "bg-purple-50", border: "border-purple-400", text: "text-purple-700" },
  entidade: { bg: "bg-green-50", border: "border-green-400", text: "text-green-700" },
  conceito: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-700" },
  norma: { bg: "bg-red-50", border: "border-red-400", text: "text-red-700" },
};

const MOCK_DATA: GraphData = {
  nodes: [
    { id: "n1", label: "Pregao 2024/0012", type: "processo" },
    { id: "n2", label: "Termo de Referencia", type: "documento" },
    { id: "n3", label: "Secretaria de Saude", type: "entidade" },
    { id: "n4", label: "Principio da Economicidade", type: "conceito" },
    { id: "n5", label: "Lei 14.133/2021 Art. 18", type: "norma" },
    { id: "n6", label: "ETP - Estudo Tecnico", type: "documento" },
  ],
  edges: [
    { source: "n1", target: "n2", relationship: "contem" },
    { source: "n1", target: "n6", relationship: "contem" },
    { source: "n3", target: "n1", relationship: "demandante" },
    { source: "n2", target: "n5", relationship: "fundamentado_em" },
    { source: "n6", target: "n5", relationship: "fundamentado_em" },
    { source: "n4", target: "n2", relationship: "orienta" },
    { source: "n6", target: "n2", relationship: "precede" },
    { source: "n3", target: "n6", relationship: "elaborou" },
  ],
};

const ALL_TYPES: GraphNode["type"][] = ["processo", "documento", "entidade", "conceito", "norma"];

export default function KnowledgeGraphViewer() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTypes, setActiveTypes] = useState<Set<GraphNode["type"]>>(new Set(ALL_TYPES));

  useEffect(() => {
    const timer = setTimeout(() => {
      setData(MOCK_DATA);
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const toggleType = (type: GraphNode["type"]) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (loading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-24 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const visibleNodes = data.nodes.filter((n) => activeTypes.has(n.type));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = data.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

  const labelOf = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-800">Grafo de Conhecimento</h2>

      <div className="flex flex-wrap gap-3">
        {ALL_TYPES.map((type) => {
          const c = NODE_COLORS[type];
          return (
            <label key={type} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={activeTypes.has(type)}
                onChange={() => toggleType(type)}
                className="rounded"
              />
              <span className={`text-sm font-medium capitalize ${c.text}`}>{type}</span>
            </label>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {visibleNodes.map((node) => {
          const c = NODE_COLORS[node.type];
          return (
            <div
              key={node.id}
              className={`rounded-lg border-2 p-4 ${c.bg} ${c.border} transition-shadow hover:shadow-md`}
            >
              <span className={`text-xs font-semibold uppercase tracking-wide ${c.text}`}>
                {node.type}
              </span>
              <p className="mt-1 text-sm font-medium text-gray-900">{node.label}</p>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Relacionamentos</h3>
        {visibleEdges.length === 0 && (
          <p className="text-sm text-gray-400 italic">Nenhum relacionamento visivel.</p>
        )}
        {visibleEdges.map((edge, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
            <span className="font-medium">{labelOf(edge.source)}</span>
            <span className="text-gray-400">&rarr;</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-600">
              {edge.relationship}
            </span>
            <span className="text-gray-400">&rarr;</span>
            <span className="font-medium">{labelOf(edge.target)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
