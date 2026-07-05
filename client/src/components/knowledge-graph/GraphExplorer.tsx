import React, { useState, useEffect } from "react";

interface ExplorerNode {
  id: string;
  label: string;
  type: "processo" | "documento" | "entidade" | "conceito" | "norma";
  neighbors: string[];
}

const TYPE_BADGE: Record<ExplorerNode["type"], string> = {
  processo: "bg-blue-100 text-blue-700",
  documento: "bg-purple-100 text-purple-700",
  entidade: "bg-green-100 text-green-700",
  conceito: "bg-orange-100 text-orange-700",
  norma: "bg-red-100 text-red-700",
};

const MOCK_NODES: ExplorerNode[] = [
  { id: "p1", label: "Pregao 2024/0012", type: "processo", neighbors: ["d1", "d2", "e1"] },
  { id: "d1", label: "Termo de Referencia", type: "documento", neighbors: ["p1", "n1", "c1"] },
  { id: "d2", label: "ETP - Estudo Tecnico", type: "documento", neighbors: ["p1", "n1", "e2"] },
  { id: "e1", label: "Secretaria de Saude", type: "entidade", neighbors: ["p1", "d2"] },
  { id: "e2", label: "Comissao de Licitacao", type: "entidade", neighbors: ["d2", "p2"] },
  { id: "n1", label: "Lei 14.133/2021 Art. 18", type: "norma", neighbors: ["d1", "d2", "c1"] },
  { id: "c1", label: "Principio da Economicidade", type: "conceito", neighbors: ["d1", "n1"] },
  { id: "c2", label: "Pesquisa de Precos", type: "conceito", neighbors: ["d1", "p2"] },
  { id: "p2", label: "Dispensa 2024/0045", type: "processo", neighbors: ["e2", "c2", "n2"] },
  { id: "n2", label: "Lei 14.133/2021 Art. 75", type: "norma", neighbors: ["p2"] },
];

type NodeType = ExplorerNode["type"] | "todos";

export default function GraphExplorer() {
  const [nodes, setNodes] = useState<ExplorerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<NodeType>("todos");
  const [selectedNode, setSelectedNode] = useState<ExplorerNode | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNodes(MOCK_NODES);
      setLoading(false);
    }, 700);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-10 w-full bg-gray-200 rounded animate-pulse" />
        <div className="h-8 w-40 bg-gray-200 rounded animate-pulse" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const filtered = nodes.filter((n) => {
    const matchesSearch = n.label.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "todos" || n.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const resolveLabel = (id: string): string => nodes.find((n) => n.id === id)?.label ?? id;
  const resolveNode = (id: string): ExplorerNode | undefined => nodes.find((n) => n.id === id);

  return (
    <div className="p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-800">Explorador do Grafo</h2>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Buscar nos..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as NodeType)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="todos">Todos os tipos</option>
          <option value="processo">Processo</option>
          <option value="documento">Documento</option>
          <option value="entidade">Entidade</option>
          <option value="conceito">Conceito</option>
          <option value="norma">Norma</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-gray-400 italic">Nenhum no encontrado.</p>
          )}
          {filtered.map((node) => (
            <button
              key={node.id}
              onClick={() => setSelectedNode(node)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selectedNode?.id === node.id
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{node.label}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${TYPE_BADGE[node.type]}`}>
                  {node.type}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{node.neighbors.length} conexoes</p>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          {!selectedNode ? (
            <p className="text-sm text-gray-400 italic text-center py-8">
              Selecione um no para ver suas conexoes.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${TYPE_BADGE[selectedNode.type]}`}>
                  {selectedNode.type}
                </span>
                <h3 className="mt-2 text-base font-semibold text-gray-900">{selectedNode.label}</h3>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Conexoes diretas ({selectedNode.neighbors.length})
                </h4>
                <ul className="space-y-2">
                  {selectedNode.neighbors.map((nId) => {
                    const neighbor = resolveNode(nId);
                    return (
                      <li key={nId} className="flex items-center justify-between text-sm">
                        <span className="text-gray-800">{resolveLabel(nId)}</span>
                        {neighbor && (
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${TYPE_BADGE[neighbor.type]}`}>
                            {neighbor.type}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
