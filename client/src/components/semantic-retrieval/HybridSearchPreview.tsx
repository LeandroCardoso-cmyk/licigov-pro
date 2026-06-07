import React, { useState } from "react";

interface HybridResult {
  id: string;
  documentId: string;
  title: string;
  excerpt: string;
  lexicalScore: number;
  semanticScore: number;
  hybridScore: number;
}

interface HybridSearchPreviewProps {
  organizationId: number;
}

interface SearchState {
  originalQuery: string;
  expandedQuery: string;
  typoCorrections: { original: string; corrected: string }[];
  synonymsUsed: string[];
  results: HybridResult[];
}

const MOCK_SEARCH: SearchState = {
  originalQuery: "requistos habilitaçao pregao eletronico",
  expandedQuery: "requisitos habilitação qualificação documentação fiscal pregão eletrônico licitação",
  typoCorrections: [
    { original: "requistos",    corrected: "requisitos" },
    { original: "habilitaçao",  corrected: "habilitação" },
    { original: "pregao",       corrected: "pregão" },
    { original: "eletronico",   corrected: "eletrônico" },
  ],
  synonymsUsed: ["qualificação", "documentação fiscal", "certidões", "licitação", "processo licitatório"],
  results: [
    { id: "r1", documentId: "doc-001", title: "Edital Pregão 045/2024",             excerpt: "...habilitação jurídica, a licitante deverá apresentar ato constitutivo e inscrição no CNPJ...",          lexicalScore: 0.88, semanticScore: 0.97, hybridScore: 0.94 },
    { id: "r2", documentId: "doc-002", title: "Contrato Administrativo 12/2024",    excerpt: "...documentos de qualificação técnica com atestados de capacidade operacional para o objeto contratado...", lexicalScore: 0.74, semanticScore: 0.89, hybridScore: 0.84 },
    { id: "r3", documentId: "doc-003", title: "Parecer Jurídico 078/2024",          excerpt: "...regularidade fiscal e trabalhista são requisitos indispensáveis para a fase de habilitação...",         lexicalScore: 0.82, semanticScore: 0.77, hybridScore: 0.79 },
    { id: "r4", documentId: "doc-005", title: "Termo de Referência TI/2024",        excerpt: "...as licitantes deverão comprovar aptidão para execução de serviços similares ao objeto licitado...",     lexicalScore: 0.68, semanticScore: 0.79, hybridScore: 0.75 },
  ],
};

function ScoreChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.125rem" }}>
      <div style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
        <div style={{ width: "36px", height: "5px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${value * 100}%`, background: color }} />
        </div>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color }}>{Math.round(value * 100)}</span>
      </div>
    </div>
  );
}

export default function HybridSearchPreview({ organizationId }: HybridSearchPreviewProps) {
  const [showDetails, setShowDetails] = useState(true);
  const search = MOCK_SEARCH;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Preview de Busca Híbrida
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{ fontSize: "0.75rem", color: "#3b82f6", border: "none", background: "none", cursor: "pointer" }}
        >
          {showDetails ? "Ocultar detalhes" : "Ver detalhes"}
        </button>
      </div>

      {showDetails && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "1rem" }}>
          <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6b7280", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Consulta original
            </div>
            <div style={{ fontSize: "0.875rem", fontFamily: "monospace", color: "#374151" }}>
              {search.originalQuery}
            </div>
          </div>

          {search.typoCorrections.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.5rem", padding: "0.75rem" }}>
              <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#92400e", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Correções aplicadas
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {search.typoCorrections.map((c, i) => (
                  <span key={i} style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "0.25rem", background: "#fef3c7", color: "#92400e" }}>
                    <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{c.original}</span>
                    {" → "}
                    <span style={{ fontWeight: 600 }}>{c.corrected}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {search.synonymsUsed.length > 0 && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "0.5rem", padding: "0.75rem" }}>
              <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#1d4ed8", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Sinônimos utilizados
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {search.synonymsUsed.map(s => (
                  <span key={s} style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "#dbeafe", color: "#1d4ed8" }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "0.5rem", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#065f46", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Consulta expandida
            </div>
            <div style={{ fontSize: "0.8125rem", fontFamily: "monospace", color: "#065f46" }}>
              {search.expandedQuery}
            </div>
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>
          Resultados ({search.results.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {search.results.map((r, idx) => (
            <div
              key={r.id}
              style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.375rem" }}>
                <div>
                  <span style={{ fontWeight: 500, fontSize: "0.8125rem", color: "#6b7280" }}>#{idx + 1} </span>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{r.title}</span>
                  <div style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>{r.documentId}</div>
                </div>
                <div style={{ display: "flex", gap: "0.875rem", flexShrink: 0, marginLeft: "0.75rem" }}>
                  <ScoreChip label="Léxico"    value={r.lexicalScore}   color="#3b82f6" />
                  <ScoreChip label="Semântico" value={r.semanticScore}  color="#10b981" />
                  <ScoreChip label="Híbrido"   value={r.hybridScore}    color="#8b5cf6" />
                </div>
              </div>
              <div style={{ fontSize: "0.8125rem", color: "#6b7280", fontStyle: "italic", lineHeight: 1.5 }}>
                {r.excerpt}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
