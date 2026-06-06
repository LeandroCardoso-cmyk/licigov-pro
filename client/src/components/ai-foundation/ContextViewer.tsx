import React, { useState } from "react";

interface ContextChunk {
  id: string;
  content: string;
  tokenCount: number;
  priority: number;
  source: string;
  chunkType: "system" | "history" | "document" | "instruction" | "user_input";
}

interface AssembledContext {
  id: string;
  chunks: ContextChunk[];
  totalTokens: number;
  maxTokens: number;
  truncated: boolean;
  assemblyStrategy: "priority" | "recency" | "balanced";
  assembledAt: string;
}

interface ContextViewerProps {
  context?: AssembledContext;
}

const CHUNK_TYPE_COLORS: Record<string, string> = {
  system:      "#8b5cf6",
  history:     "#3b82f6",
  document:    "#10b981",
  instruction: "#f59e0b",
  user_input:  "#ec4899",
};

const CHUNK_TYPE_LABELS: Record<string, string> = {
  system:      "Sistema",
  history:     "Histórico",
  document:    "Documento",
  instruction: "Instrução",
  user_input:  "Entrada do usuário",
};

export function ContextViewer({ context }: ContextViewerProps) {
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);

  if (!context) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "1rem", textAlign: "center", color: "#9ca3af" }}>
        Nenhum contexto montado.
      </div>
    );
  }

  const utilizationPercent = Math.round((context.totalTokens / context.maxTokens) * 100);
  const barColor = utilizationPercent > 90 ? "#ef4444" : utilizationPercent > 70 ? "#f59e0b" : "#10b981";

  const byType = context.chunks.reduce<Record<string, number>>((acc, c) => {
    acc[c.chunkType] = (acc[c.chunkType] ?? 0) + c.tokenCount;
    return acc;
  }, {});

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Visualizador de Contexto
      </h2>

      <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
            Uso de tokens: {context.totalTokens.toLocaleString()} / {context.maxTokens.toLocaleString()}
          </span>
          <span style={{ fontSize: "0.875rem", color: barColor, fontWeight: 600 }}>{utilizationPercent}%</span>
        </div>
        <div style={{ height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(utilizationPercent, 100)}%`, background: barColor, transition: "width 0.3s" }} />
        </div>
        {context.truncated && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#f59e0b" }}>
            ⚠️ Contexto truncado para caber no limite de tokens
          </div>
        )}
        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {Object.entries(byType).map(([type, tokens]) => (
            <span key={type} style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: CHUNK_TYPE_COLORS[type] ?? "#9ca3af", color: "white" }}>
              {CHUNK_TYPE_LABELS[type] ?? type}: {tokens} tokens
            </span>
          ))}
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#6b7280" }}>
          Estratégia: {context.assemblyStrategy} • {context.chunks.length} chunks • {new Date(context.assembledAt).toLocaleString("pt-BR")}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {context.chunks.map((chunk, idx) => (
          <div
            key={chunk.id}
            style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}
          >
            <div
              onClick={() => setExpandedChunk(expandedChunk === chunk.id ? null : chunk.id)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.5rem 0.75rem", cursor: "pointer", background: "#f9fafb",
                borderLeft: `4px solid ${CHUNK_TYPE_COLORS[chunk.chunkType] ?? "#9ca3af"}`
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>#{idx + 1}</span>
                <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>{chunk.source}</span>
                <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.375rem", borderRadius: "9999px", background: CHUNK_TYPE_COLORS[chunk.chunkType] ?? "#9ca3af", color: "white" }}>
                  {CHUNK_TYPE_LABELS[chunk.chunkType] ?? chunk.chunkType}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{chunk.tokenCount} tokens</span>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>P:{chunk.priority}</span>
                <span style={{ fontSize: "0.75rem" }}>{expandedChunk === chunk.id ? "▲" : "▼"}</span>
              </div>
            </div>
            {expandedChunk === chunk.id && (
              <div style={{ padding: "0.75rem", fontSize: "0.8125rem", whiteSpace: "pre-wrap", fontFamily: "monospace", background: "white", borderTop: "1px solid #e5e7eb", maxHeight: "200px", overflowY: "auto" }}>
                {chunk.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
