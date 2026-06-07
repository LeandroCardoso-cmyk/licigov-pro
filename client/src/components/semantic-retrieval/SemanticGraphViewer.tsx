import React, { useState } from "react";

interface GraphNode {
  nodeId: string;
  type: "document" | "concept" | "entity" | "regulation";
  label: string;
  score: number;
}

interface GraphEdge {
  edgeId: string;
  source: string;
  target: string;
  edgeType: "references" | "supersedes" | "related_to" | "implements" | "cites";
  weight: number;
}

interface SemanticGraphViewerProps {
  organizationId: number;
}

const MOCK_NODES: GraphNode[] = [
  { nodeId: "n-001", type: "document",   label: "Edital Pregão 045/2024",            score: 0.94 },
  { nodeId: "n-002", type: "regulation", label: "Lei 14.133/2021",                   score: 0.99 },
  { nodeId: "n-003", type: "concept",    label: "Habilitação Jurídica",               score: 0.87 },
  { nodeId: "n-004", type: "document",   label: "Contrato Administrativo 12/2024",   score: 0.85 },
  { nodeId: "n-005", type: "entity",     label: "Secretaria de Administração",        score: 0.78 },
  { nodeId: "n-006", type: "concept",    label: "Pregão Eletrônico",                  score: 0.91 },
  { nodeId: "n-007", type: "regulation", label: "Decreto 10.024/2019",               score: 0.89 },
  { nodeId: "n-008", type: "document",   label: "Parecer Jurídico 078/2024",         score: 0.81 },
  { nodeId: "n-009", type: "concept",    label: "Qualificação Técnica",               score: 0.83 },
];

const MOCK_EDGES: GraphEdge[] = [
  { edgeId: "e-001", source: "n-001", target: "n-002", edgeType: "implements",  weight: 0.95 },
  { edgeId: "e-002", source: "n-001", target: "n-003", edgeType: "references",  weight: 0.88 },
  { edgeId: "e-003", source: "n-001", target: "n-006", edgeType: "related_to",  weight: 0.92 },
  { edgeId: "e-004", source: "n-004", target: "n-001", edgeType: "references",  weight: 0.84 },
  { edgeId: "e-005", source: "n-006", target: "n-007", edgeType: "implements",  weight: 0.91 },
  { edgeId: "e-006", source: "n-008", target: "n-002", edgeType: "cites",       weight: 0.79 },
  { edgeId: "e-007", source: "n-003", target: "n-009", edgeType: "related_to",  weight: 0.76 },
];

const NODE_TYPE_COLORS: Record<string, string> = {
  document:   "#3b82f6",
  concept:    "#8b5cf6",
  entity:     "#10b981",
  regulation: "#ef4444",
};

const NODE_TYPE_LABELS: Record<string, string> = {
  document:   "Documento",
  concept:    "Conceito",
  entity:     "Entidade",
  regulation: "Norma",
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  references:  "Referencia",
  supersedes:  "Substitui",
  related_to:  "Relacionado",
  implements:  "Implementa",
  cites:       "Cita",
};

export default function SemanticGraphViewer({ organizationId }: SemanticGraphViewerProps) {
  const [tab, setTab] = useState<"nodes" | "edges">("nodes");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filteredNodes = typeFilter === "all"
    ? MOCK_NODES
    : MOCK_NODES.filter(n => n.type === typeFilter);

  const nodeMap = Object.fromEntries(MOCK_NODES.map(n => [n.nodeId, n]));

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Grafo Semântico
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{MOCK_NODES.length}</div>
            <div style={{ fontSize: "0.6875rem", color: "#6b7280" }}>nós</div>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{MOCK_EDGES.length}</div>
            <div style={{ fontSize: "0.6875rem", color: "#6b7280" }}>arestas</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0", marginBottom: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
        {(["nodes", "edges"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "0.5rem", border: "none", cursor: "pointer", fontSize: "0.8125rem",
              background: tab === t ? "#3b82f6" : "white",
              color: tab === t ? "white" : "#374151", fontWeight: 500,
            }}
          >
            {t === "nodes" ? `Nós (${MOCK_NODES.length})` : `Arestas (${MOCK_EDGES.length})`}
          </button>
        ))}
      </div>

      {tab === "nodes" && (
        <>
          <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {["all", "document", "concept", "entity", "regulation"].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: "0.25rem 0.625rem", borderRadius: "9999px", border: "1px solid #d1d5db",
                  cursor: "pointer", fontSize: "0.75rem",
                  background: typeFilter === t ? (NODE_TYPE_COLORS[t] ?? "#374151") : "white",
                  color: typeFilter === t ? "white" : "#374151",
                }}
              >
                {t === "all" ? "Todos" : NODE_TYPE_LABELS[t] ?? t}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {filteredNodes.map(node => (
              <div
                key={node.nodeId}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.5rem 0.75rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem",
                  borderLeft: `4px solid ${NODE_TYPE_COLORS[node.type]}`,
                }}
              >
                <div>
                  <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{node.label}</span>
                  <span style={{
                    marginLeft: "0.5rem", fontSize: "0.6875rem", padding: "0.125rem 0.375rem",
                    borderRadius: "9999px", background: NODE_TYPE_COLORS[node.type], color: "white",
                  }}>
                    {NODE_TYPE_LABELS[node.type]}
                  </span>
                  <div style={{ fontSize: "0.6875rem", color: "#9ca3af", marginTop: "0.125rem" }}>{node.nodeId}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                  <div style={{ width: "40px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${node.score * 100}%`, background: node.score > 0.8 ? "#10b981" : "#f59e0b" }} />
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#374151" }}>{Math.round(node.score * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "edges" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_EDGES.map(edge => {
            const src = nodeMap[edge.source];
            const tgt = nodeMap[edge.target];
            return (
              <div
                key={edge.edgeId}
                style={{
                  padding: "0.5rem 0.75rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <span style={{ fontWeight: 500, color: NODE_TYPE_COLORS[src?.type ?? "document"] }}>{src?.label ?? edge.source}</span>
                    <span style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px", background: "#e5e7eb", color: "#374151" }}>
                      {EDGE_TYPE_LABELS[edge.edgeType] ?? edge.edgeType}
                    </span>
                    <span style={{ fontWeight: 500, color: NODE_TYPE_COLORS[tgt?.type ?? "document"] }}>{tgt?.label ?? edge.target}</span>
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "#9ca3af", marginTop: "0.125rem" }}>{edge.edgeId}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                  <div style={{ width: "40px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${edge.weight * 100}%`, background: "#8b5cf6" }} />
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#374151" }}>{Math.round(edge.weight * 100)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
