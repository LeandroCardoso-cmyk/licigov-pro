import React, { useState } from "react";

interface SemanticMemoryEntry {
  id: string;
  memoryType: "semantic" | "contextual" | "institutional";
  key: string;
  value: string;
  sourceRef?: string;
  relevanceScore: number;
  lastAccessedAt?: string;
  accessCount: number;
  isActive: boolean;
  ttlMs?: number;
  createdAt: string;
}

interface SemanticMemoryPanelProps {
  memories?: SemanticMemoryEntry[];
  onDeactivate?: (id: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  semantic:      "#8b5cf6",
  contextual:    "#3b82f6",
  institutional: "#10b981",
};

const TYPE_LABELS: Record<string, string> = {
  semantic:      "Semântica",
  contextual:    "Contextual",
  institutional: "Institucional",
};

export function SemanticMemoryPanel({ memories = [], onDeactivate }: SemanticMemoryPanelProps) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = memories
    .filter(m => showInactive || m.isActive)
    .filter(m => typeFilter === "all" || m.memoryType === typeFilter)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const stats = {
    total: memories.length,
    active: memories.filter(m => m.isActive).length,
    semantic: memories.filter(m => m.memoryType === "semantic").length,
    contextual: memories.filter(m => m.memoryType === "contextual").length,
    institutional: memories.filter(m => m.memoryType === "institutional").length,
  };

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Memória Semântica
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "1rem" }}>
        {[
          { label: "Total", value: stats.total, color: "#374151" },
          { label: "Ativas", value: stats.active, color: "#10b981" },
          { label: "Semântica", value: stats.semantic, color: "#8b5cf6" },
          { label: "Institucional", value: stats.institutional, color: "#3b82f6" },
        ].map(s => (
          <div key={s.label} style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {["all", "semantic", "contextual", "institutional"].map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            style={{
              padding: "0.25rem 0.75rem", borderRadius: "9999px", border: "1px solid #d1d5db", cursor: "pointer", fontSize: "0.8125rem",
              background: typeFilter === t ? (TYPE_COLORS[t] ?? "#3b82f6") : "white",
              color: typeFilter === t ? "white" : "#374151"
            }}
          >
            {t === "all" ? "Todos" : TYPE_LABELS[t] ?? t}
          </button>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8125rem", cursor: "pointer", marginLeft: "auto" }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Mostrar inativas
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "2rem" }}>Nenhuma memória encontrada.</div>
        ) : filtered.map(mem => (
          <div
            key={mem.id}
            style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden", opacity: mem.isActive ? 1 : 0.6 }}
          >
            <div
              onClick={() => setExpandedId(expandedId === mem.id ? null : mem.id)}
              style={{
                padding: "0.5rem 0.75rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                borderLeft: `4px solid ${TYPE_COLORS[mem.memoryType]}`
              }}
            >
              <div>
                <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{mem.key}</span>
                <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", padding: "0.125rem 0.375rem", background: TYPE_COLORS[mem.memoryType], color: "white", borderRadius: "9999px" }}>
                  {TYPE_LABELS[mem.memoryType]}
                </span>
                {!mem.isActive && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#9ca3af" }}>(inativa)</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ width: "48px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${mem.relevanceScore * 100}%`, background: mem.relevanceScore > 0.7 ? "#10b981" : mem.relevanceScore > 0.4 ? "#f59e0b" : "#ef4444" }} />
                </div>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{Math.round(mem.relevanceScore * 100)}%</span>
                <span style={{ fontSize: "0.75rem" }}>{expandedId === mem.id ? "▲" : "▼"}</span>
              </div>
            </div>
            {expandedId === mem.id && (
              <div style={{ padding: "0.75rem", borderTop: "1px solid #f3f4f6", background: "#fafafa" }}>
                <div style={{ fontSize: "0.8125rem", color: "#374151", marginBottom: "0.5rem" }}>{mem.value.slice(0, 300)}{mem.value.length > 300 ? "..." : ""}</div>
                <div style={{ display: "flex", gap: "1rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                  <span>Acessos: {mem.accessCount}</span>
                  {mem.sourceRef && <span>Fonte: {mem.sourceRef}</span>}
                  {mem.lastAccessedAt && <span>Último acesso: {new Date(mem.lastAccessedAt).toLocaleString("pt-BR")}</span>}
                  {mem.ttlMs && <span>TTL: {Math.round(mem.ttlMs / 1000 / 60)}min</span>}
                </div>
                {mem.isActive && onDeactivate && (
                  <button
                    onClick={() => onDeactivate(mem.id)}
                    style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#ef4444", border: "none", background: "none", cursor: "pointer" }}
                  >
                    Desativar memória
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
