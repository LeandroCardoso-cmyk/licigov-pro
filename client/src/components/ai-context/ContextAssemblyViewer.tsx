import React, { useState } from "react";

interface ContextFragment {
  id: string;
  source: string;
  priority: "critical" | "high" | "medium" | "low";
  tokenEstimate: number;
  relevanceScore: number;
  isStale: boolean;
  layerType: "legal" | "workflow" | "retrieval";
  order: number;
}

interface ContextLayer {
  id: string;
  type: "legal" | "workflow" | "retrieval";
  fragmentCount: number;
}

interface ContextAssembly {
  totalTokens: number;
  maxTokens: number;
  status: "open" | "saturated" | "pruned" | "archived";
  layers: ContextLayer[];
  fragments: ContextFragment[];
  suppressedFragments: ContextFragment[];
}

interface ContextAssemblyViewerProps {
  organizationId: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#6b7280",
};

const LAYER_COLORS: Record<string, string> = {
  legal: "#3b82f6",
  workflow: "#8b5cf6",
  retrieval: "#10b981",
};

const STATUS_COLORS: Record<string, string> = {
  open: "#10b981",
  saturated: "#ef4444",
  pruned: "#f59e0b",
  archived: "#9ca3af",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Aberto",
  saturated: "Saturado",
  pruned: "Podado",
  archived: "Arquivado",
};

const MOCK_ASSEMBLY: ContextAssembly = {
  totalTokens: 6840,
  maxTokens: 8192,
  status: "open",
  layers: [
    { id: "l1", type: "legal", fragmentCount: 2 },
    { id: "l2", type: "workflow", fragmentCount: 2 },
    { id: "l3", type: "retrieval", fragmentCount: 1 },
  ],
  fragments: [
    { id: "f1", source: "Lei 14.133/2021 Art. 75", priority: "critical", tokenEstimate: 820, relevanceScore: 0.97, isStale: false, layerType: "legal", order: 1 },
    { id: "f2", source: "Decreto 10.947/2022", priority: "high", tokenEstimate: 640, relevanceScore: 0.84, isStale: false, layerType: "legal", order: 2 },
    { id: "f3", source: "Checklist Fase Interna", priority: "high", tokenEstimate: 530, relevanceScore: 0.79, isStale: false, layerType: "workflow", order: 3 },
    { id: "f4", source: "Template Edital Padrão", priority: "medium", tokenEstimate: 480, relevanceScore: 0.71, isStale: true, layerType: "workflow", order: 4 },
    { id: "f5", source: "TCU Acórdão 1234/2023", priority: "medium", tokenEstimate: 390, relevanceScore: 0.65, isStale: false, layerType: "retrieval", order: 5 },
  ],
  suppressedFragments: [
    { id: "f6", source: "Instrução Normativa 58/2022", priority: "low", tokenEstimate: 710, relevanceScore: 0.42, isStale: true, layerType: "legal", order: 6 },
    { id: "f7", source: "Histórico Sessão Anterior", priority: "low", tokenEstimate: 290, relevanceScore: 0.31, isStale: true, layerType: "retrieval", order: 7 },
  ],
};

export default function ContextAssemblyViewer({ organizationId: _organizationId }: ContextAssemblyViewerProps) {
  const [suppressedOpen, setSuppressedOpen] = useState(false);
  const assembly = MOCK_ASSEMBLY;

  const utilizationPercent = Math.round((assembly.totalTokens / assembly.maxTokens) * 100);
  const barColor = utilizationPercent > 90 ? "#ef4444" : utilizationPercent > 70 ? "#f59e0b" : "#10b981";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Visualizador de Assembly Contextual</h2>
        <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.625rem", borderRadius: "9999px", background: STATUS_COLORS[assembly.status], color: "white", fontWeight: 600 }}>
          {STATUS_LABELS[assembly.status]}
        </span>
      </div>

      <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
            {assembly.totalTokens.toLocaleString()} / {assembly.maxTokens.toLocaleString()} tokens
          </span>
          <span style={{ fontSize: "0.875rem", color: barColor, fontWeight: 600 }}>{utilizationPercent}%</span>
        </div>
        <div style={{ height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(utilizationPercent, 100)}%`, background: barColor, transition: "width 0.3s" }} />
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>Camadas</h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {assembly.layers.map(layer => (
            <div key={layer.id} style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.375rem 0.75rem", background: "white", border: `1px solid ${LAYER_COLORS[layer.type]}`, borderRadius: "0.375rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: LAYER_COLORS[layer.type], flexShrink: 0 }} />
              <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: LAYER_COLORS[layer.type] }}>{layer.type}</span>
              <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{layer.fragmentCount} fragmentos</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
          Fragmentos Ativos ({assembly.fragments.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {assembly.fragments.map(frag => (
            <div key={frag.id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: "white", borderLeft: `3px solid ${LAYER_COLORS[frag.layerType]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>#{frag.order}</span>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{frag.source}</span>
                  {frag.isStale && (
                    <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", background: "#fef3c7", color: "#92400e", borderRadius: "9999px", border: "1px solid #fde68a" }}>
                      desatualizado
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: PRIORITY_COLORS[frag.priority], color: "white" }}>
                    {frag.priority}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{frag.tokenEstimate} tk</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Relevância</span>
                <div style={{ flex: 1, height: "5px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round(frag.relevanceScore * 100)}%`, background: frag.relevanceScore >= 0.7 ? "#10b981" : frag.relevanceScore >= 0.5 ? "#f59e0b" : "#ef4444" }} />
                </div>
                <span style={{ fontSize: "0.75rem", color: "#374151", minWidth: "2.5rem", textAlign: "right" }}>{Math.round(frag.relevanceScore * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <button
          onClick={() => setSuppressedOpen(o => !o)}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", padding: "0.5rem 0.75rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500 }}
        >
          <span style={{ transform: suppressedOpen ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.2s" }}>▶</span>
          Fragmentos Suprimidos ({assembly.suppressedFragments.length})
        </button>
        {suppressedOpen && (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {assembly.suppressedFragments.map(frag => (
              <div key={frag.id} style={{ border: "1px dashed #e5e7eb", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", background: "#fafafa", opacity: 0.75 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.8125rem", color: "#6b7280" }}>{frag.source}</span>
                    {frag.isStale && (
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", background: "#fef3c7", color: "#92400e", borderRadius: "9999px" }}>desatualizado</span>
                    )}
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{frag.tokenEstimate} tk · {Math.round(frag.relevanceScore * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
