import React, { useState } from "react";

interface SemanticSearchPanelProps {
  organizationId: number;
  onSearch: (query: string) => void;
}

export default function SemanticSearchPanel({ organizationId, onSearch }: SemanticSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [expandSynonyms, setExpandSynonyms] = useState(true);
  const [fixTypos, setFixTypos] = useState(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Busca Semântica
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ex: requisitos de habilitação para pregão eletrônico..."
            style={{
              flex: 1, padding: "0.625rem 0.875rem", border: "1px solid #d1d5db",
              borderRadius: "0.5rem", fontSize: "0.875rem", outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!query.trim()}
            style={{
              padding: "0.625rem 1.25rem", background: "#3b82f6", color: "white",
              border: "none", borderRadius: "0.5rem", fontSize: "0.875rem",
              cursor: query.trim() ? "pointer" : "not-allowed",
              opacity: query.trim() ? 1 : 0.5,
            }}
          >
            Buscar
          </button>
        </div>

        <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", display: "flex", gap: "1.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={expandSynonyms}
              onChange={e => setExpandSynonyms(e.target.checked)}
              style={{ accentColor: "#3b82f6" }}
            />
            <span style={{ fontWeight: 500 }}>Expandir sinônimos</span>
            <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
              — inclui termos relacionados automaticamente
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={fixTypos}
              onChange={e => setFixTypos(e.target.checked)}
              style={{ accentColor: "#3b82f6" }}
            />
            <span style={{ fontWeight: 500 }}>Corrigir erros de digitação</span>
            <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
              — normaliza variações ortográficas
            </span>
          </label>
        </div>
      </form>

      {(expandSynonyms || fixTypos) && (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {expandSynonyms && (
            <span style={{ fontSize: "0.6875rem", padding: "0.25rem 0.625rem", borderRadius: "9999px", background: "#dbeafe", color: "#1d4ed8" }}>
              Expansão de sinônimos ativa
            </span>
          )}
          {fixTypos && (
            <span style={{ fontSize: "0.6875rem", padding: "0.25rem 0.625rem", borderRadius: "9999px", background: "#d1fae5", color: "#065f46" }}>
              Correção de typos ativa
            </span>
          )}
        </div>
      )}
    </div>
  );
}
