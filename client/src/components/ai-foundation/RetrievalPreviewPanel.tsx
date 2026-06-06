import React, { useState } from "react";

interface VectorSearchResult {
  id: string;
  content: string;
  similarity: number;
  rank: number;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

interface RetrievalPreviewPanelProps {
  results?: VectorSearchResult[];
  query?: string;
  indexName?: string;
  searchDurationMs?: number;
  onSelectResult?: (id: string) => void;
}

export function RetrievalPreviewPanel({ results = [], query, indexName, searchDurationMs, onSelectResult }: RetrievalPreviewPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0);

  const filtered = results.filter(r => r.similarity >= threshold);

  const handleSelect = (id: string) => {
    setSelected(id === selected ? null : id);
    onSelectResult?.(id);
  };

  const getSimilarityColor = (sim: number) =>
    sim >= 0.8 ? "#10b981" : sim >= 0.6 ? "#3b82f6" : sim >= 0.4 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Prévia de Recuperação Vetorial
      </h2>

      {(query || indexName) && (
        <div style={{ background: "#eff6ff", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", marginBottom: "0.75rem", fontSize: "0.8125rem" }}>
          {indexName && <span style={{ color: "#1d4ed8", fontWeight: 500 }}>Índice: {indexName} </span>}
          {query && <span style={{ color: "#374151" }}>| Query: <em>"{query}"</em></span>}
          {searchDurationMs != null && <span style={{ color: "#9ca3af", marginLeft: "0.5rem" }}>• {searchDurationMs}ms</span>}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", fontSize: "0.8125rem" }}>
        <label style={{ color: "#374151", whiteSpace: "nowrap" }}>
          Similaridade mínima: <strong>{Math.round(threshold * 100)}%</strong>
        </label>
        <input
          type="range" min={0} max={100} step={5}
          value={Math.round(threshold * 100)}
          onChange={e => setThreshold(Number(e.target.value) / 100)}
          style={{ flex: 1 }}
        />
        <span style={{ color: "#6b7280", whiteSpace: "nowrap" }}>{filtered.length}/{results.length} resultados</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: "2rem" }}>
          {results.length === 0 ? "Nenhum resultado de busca." : "Nenhum resultado acima do threshold."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {filtered.map(result => (
            <div
              key={result.id}
              onClick={() => handleSelect(result.id)}
              style={{
                border: `1px solid ${selected === result.id ? "#3b82f6" : "#e5e7eb"}`,
                borderRadius: "0.5rem", padding: "0.75rem", cursor: "pointer",
                background: selected === result.id ? "#eff6ff" : "white",
                transition: "border-color 0.15s"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>#{result.rank}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ width: "60px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${result.similarity * 100}%`, background: getSimilarityColor(result.similarity) }} />
                  </div>
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: getSimilarityColor(result.similarity) }}>
                    {Math.round(result.similarity * 100)}%
                  </span>
                </div>
              </div>
              <div style={{ fontSize: "0.8125rem", color: "#374151" }}>
                {result.content.slice(0, 150)}{result.content.length > 150 ? "..." : ""}
              </div>
              {selected === result.id && Object.keys(result.metadata).length > 0 && (
                <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f9fafb", borderRadius: "0.375rem" }}>
                  {Object.entries(result.metadata).map(([k, v]) => (
                    <div key={k} style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                      <strong>{k}:</strong> {String(v)}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: "0.75rem", color: "#d1d5db", marginTop: "0.25rem" }}>
                Indexado: {new Date(result.indexedAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
