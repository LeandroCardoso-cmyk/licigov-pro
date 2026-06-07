import React from "react";

interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  deduplicatedCount: number;
  overlapRemovedCount: number;
  removedFragments: string[];
}

interface SemanticCompressionViewerProps {
  organizationId: number;
}

const MOCK_STATS: CompressionStats = {
  originalTokens: 2048,
  compressedTokens: 1200,
  compressionRatio: 0.414,
  deduplicatedCount: 3,
  overlapRemovedCount: 5,
  removedFragments: [
    "Instrução Normativa 73/2022 (overlap 94% com Lei 14.133)",
    "Resumo de sessão anterior — desatualizado",
    "Contexto de erro de validação — não relevante",
  ],
};

export default function SemanticCompressionViewer({ organizationId: _organizationId }: SemanticCompressionViewerProps) {
  const stats = MOCK_STATS;
  const savedTokens = stats.originalTokens - stats.compressedTokens;
  const savedPercent = Math.round((savedTokens / stats.originalTokens) * 100);
  const compressionPct = Math.round(stats.compressionRatio * 100);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>Visualizador de Compressão Semântica</h2>
      <p style={{ fontSize: "0.8125rem", color: "#6b7280", marginBottom: "1rem", marginTop: 0 }}>
        Remoção inteligente de duplicatas e sobreposições no contexto
      </p>

      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.75rem", padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.25rem" }}>Antes</div>
            <div style={{ fontWeight: 700, fontSize: "1.5rem", color: "#374151" }}>{stats.originalTokens.toLocaleString()}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>tokens</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
            <div style={{ fontSize: "0.7rem", color: "#10b981", fontWeight: 600 }}>-{savedPercent}%</div>
            <div style={{ fontSize: "1.5rem", color: "#10b981" }}>→</div>
            <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>comprimido</div>
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.25rem" }}>Depois</div>
            <div style={{ fontWeight: 700, fontSize: "1.5rem", color: "#10b981" }}>{stats.compressedTokens.toLocaleString()}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>tokens</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.375rem" }}>
          <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>Taxa de compressão</span>
          <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#10b981" }}>{compressionPct}%</span>
        </div>
        <div style={{ height: "12px", background: "#e5e7eb", borderRadius: "6px", overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            <div style={{ height: "100%", width: `${100 - compressionPct}%`, background: "#3b82f6" }} />
            <div style={{ height: "100%", flex: 1, background: "#e5e7eb" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem", fontSize: "0.75rem", color: "#9ca3af" }}>
          <span style={{ color: "#3b82f6" }}>● Mantido: {Math.round((1 - stats.compressionRatio) * 100)}%</span>
          <span>● Removido: {compressionPct}%</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginBottom: "1rem" }}>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#8b5cf6" }}>{stats.deduplicatedCount}</div>
          <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.125rem" }}>Deduplicados</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#f97316" }}>{stats.overlapRemovedCount}</div>
          <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.125rem" }}>Sobreposições</div>
        </div>
        <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ef4444" }}>{stats.removedFragments.length}</div>
          <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.125rem" }}>Removidos</div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>Fragmentos Removidos</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {stats.removedFragments.map((frag, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.375rem 0.625rem", background: "#fef2f2", borderRadius: "0.375rem", borderLeft: "3px solid #fca5a5" }}>
              <span style={{ color: "#ef4444", fontSize: "0.8125rem", flexShrink: 0 }}>✕</span>
              <span style={{ fontSize: "0.8125rem", color: "#374151" }}>{frag}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
