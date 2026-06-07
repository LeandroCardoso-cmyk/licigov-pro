import React, { useState } from "react";

interface RankedDocument {
  position: number;
  documentId: string;
  title: string;
  hybridScore: number;
  lexicalScore: number;
  semanticScore: number;
  contextualScore: number;
}

interface ContextualRankingPanelProps {
  organizationId: number;
}

const MOCK_RANKED: RankedDocument[] = [
  { position: 1, documentId: "doc-001", title: "Edital Pregão 045/2024", hybridScore: 0.94, lexicalScore: 0.88, semanticScore: 0.97, contextualScore: 0.91 },
  { position: 2, documentId: "doc-002", title: "Contrato Administrativo 12/2024", hybridScore: 0.87, lexicalScore: 0.79, semanticScore: 0.91, contextualScore: 0.85 },
  { position: 3, documentId: "doc-003", title: "Parecer Jurídico 078/2024", hybridScore: 0.81, lexicalScore: 0.85, semanticScore: 0.76, contextualScore: 0.79 },
  { position: 4, documentId: "doc-005", title: "Termo de Referência TI/2024", hybridScore: 0.74, lexicalScore: 0.71, semanticScore: 0.78, contextualScore: 0.72 },
  { position: 5, documentId: "doc-004", title: "Ata de Registro de Preços 007/2024", hybridScore: 0.68, lexicalScore: 0.62, semanticScore: 0.72, contextualScore: 0.64 },
];

type SortKey = "hybridScore" | "lexicalScore" | "semanticScore" | "contextualScore";

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <div style={{ width: "64px", height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ height: "100%", width: `${value * 100}%`, background: color, borderRadius: "4px" }} />
      </div>
      <span style={{ fontSize: "0.75rem", color: "#374151", fontVariantNumeric: "tabular-nums" }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

export default function ContextualRankingPanel({ organizationId }: ContextualRankingPanelProps) {
  const [sortBy, setSortBy] = useState<SortKey>("hybridScore");

  const sorted = [...MOCK_RANKED].sort((a, b) => b[sortBy] - a[sortBy]).map((d, idx) => ({ ...d, position: idx + 1 }));

  const headers: { key: SortKey; label: string; color: string }[] = [
    { key: "hybridScore",    label: "Híbrido",    color: "#8b5cf6" },
    { key: "lexicalScore",   label: "Léxico",     color: "#3b82f6" },
    { key: "semanticScore",  label: "Semântico",  color: "#10b981" },
    { key: "contextualScore",label: "Contextual", color: "#f59e0b" },
  ];

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Ranking Contextual
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {headers.map(h => (
          <button
            key={h.key}
            onClick={() => setSortBy(h.key)}
            style={{
              padding: "0.25rem 0.75rem", borderRadius: "9999px", border: "1px solid #d1d5db",
              cursor: "pointer", fontSize: "0.75rem",
              background: sortBy === h.key ? h.color : "white",
              color: sortBy === h.key ? "white" : "#374151",
            }}
          >
            Ordenar por {h.label}
          </button>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>#</th>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>Documento</th>
              {headers.map(h => (
                <th
                  key={h.key}
                  style={{
                    padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600,
                    color: sortBy === h.key ? h.color : "#374151",
                    borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
                  }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(doc => (
              <tr
                key={doc.documentId}
                style={{ borderBottom: "1px solid #f3f4f6", background: doc.position === 1 ? "#fffbeb" : "white" }}
              >
                <td style={{ padding: "0.625rem 0.75rem", fontWeight: 700, color: doc.position === 1 ? "#d97706" : "#6b7280" }}>
                  {doc.position === 1 ? "★" : doc.position}
                </td>
                <td style={{ padding: "0.625rem 0.75rem" }}>
                  <div style={{ fontWeight: 500 }}>{doc.title}</div>
                  <div style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>{doc.documentId}</div>
                </td>
                {headers.map(h => (
                  <td key={h.key} style={{ padding: "0.625rem 0.75rem" }}>
                    <ScoreBar value={doc[h.key]} color={h.color} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
