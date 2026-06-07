import React, { useState } from "react";

type SourceType = "lei" | "tcu" | "precedente" | "documento";
type HallucinationRisk = "low" | "medium" | "high";

interface GroundingSource {
  id: string;
  citation: string;
  sourceType: SourceType;
  authority: number;
  isVerified: boolean;
  excerpt: string;
}

interface GroundingEvidenceExplorerProps {
  organizationId: number;
}

const SOURCE_TYPE_CONFIG: Record<SourceType, { label: string; color: string; bg: string }> = {
  lei:        { label: "Lei",        color: "#1d4ed8", bg: "#dbeafe" },
  tcu:        { label: "TCU",        color: "#7c3aed", bg: "#ede9fe" },
  precedente: { label: "Precedente", color: "#b45309", bg: "#fef3c7" },
  documento:  { label: "Documento",  color: "#065f46", bg: "#d1fae5" },
};

const RISK_CONFIG: Record<HallucinationRisk, { label: string; color: string; bg: string }> = {
  low:    { label: "Baixo",  color: "#10b981", bg: "#ecfdf5" },
  medium: { label: "Médio",  color: "#f59e0b", bg: "#fffbeb" },
  high:   { label: "Alto",   color: "#ef4444", bg: "#fef2f2" },
};

const MOCK_SOURCES: GroundingSource[] = [
  {
    id: "gs1",
    citation: "Lei 14.133/2021, Art. 75, § 3º",
    sourceType: "lei",
    authority: 0.98,
    isVerified: true,
    excerpt: "A dispensa de licitação nas hipóteses dos incisos I e II do caput deste artigo não poderá exceder, em cada exercício financeiro, ao montante fixado em ato do Poder Executivo federal.",
  },
  {
    id: "gs2",
    citation: "TCU Acórdão 2.622/2015 – Plenário",
    sourceType: "tcu",
    authority: 0.91,
    isVerified: true,
    excerpt: "A administração deve observar os princípios da isonomia, competitividade e seleção da proposta mais vantajosa ao elaborar os critérios de julgamento.",
  },
  {
    id: "gs3",
    citation: "AGU Parecer n. 14/2023",
    sourceType: "precedente",
    authority: 0.74,
    isVerified: false,
    excerpt: "O entendimento consolidado aponta para a necessidade de motivação expressa nas contratações diretas, incluindo pesquisa de preços prévia documentada.",
  },
  {
    id: "gs4",
    citation: "Edital Modelo SEGES 003/2024",
    sourceType: "documento",
    authority: 0.62,
    isVerified: true,
    excerpt: "O presente edital adota o critério de menor preço por item para os grupos de materiais de consumo, conforme especificações do Termo de Referência.",
  },
];

const MOCK_HALLUCINATION_RISK: HallucinationRisk = "low";
const MOCK_GROUNDING_CONFIDENCE = 0.88;

function AuthorityBar({ value }: { value: number }) {
  const color = value >= 0.8 ? "#10b981" : value >= 0.6 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <div style={{ width: "80px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function GroundingEvidenceExplorer({ organizationId: _organizationId }: GroundingEvidenceExplorerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const riskCfg = RISK_CONFIG[MOCK_HALLUCINATION_RISK];
  const confidencePct = Math.round(MOCK_GROUNDING_CONFIDENCE * 100);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>Explorador de Evidências de Grounding</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ background: riskCfg.bg, border: `1px solid ${riskCfg.color}`, borderRadius: "0.5rem", padding: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Risco de Alucinação</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: riskCfg.color }}>{riskCfg.label}</div>
        </div>
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Confiança de Grounding</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ flex: 1, height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${confidencePct}%`, background: confidencePct >= 80 ? "#10b981" : "#f59e0b" }} />
            </div>
            <span style={{ fontWeight: 700, color: confidencePct >= 80 ? "#10b981" : "#f59e0b" }}>{confidencePct}%</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {MOCK_SOURCES.map(src => {
          const typeCfg = SOURCE_TYPE_CONFIG[src.sourceType];
          const isOpen = expanded === src.id;
          return (
            <div key={src.id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
              <div
                onClick={() => setExpanded(isOpen ? null : src.id)}
                style={{ padding: "0.625rem 0.75rem", cursor: "pointer", background: isOpen ? "#f9fafb" : "white" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.375rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.75rem", padding: "0.1rem 0.5rem", borderRadius: "9999px", background: typeCfg.bg, color: typeCfg.color, fontWeight: 600 }}>
                      {typeCfg.label}
                    </span>
                    <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{src.citation}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                    {src.isVerified ? (
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", background: "#ecfdf5", color: "#10b981", borderRadius: "9999px", border: "1px solid #a7f3d0" }}>✓ Verificado</span>
                    ) : (
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", background: "#fef2f2", color: "#ef4444", borderRadius: "9999px", border: "1px solid #fca5a5" }}>Não verificado</span>
                    )}
                    <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{isOpen ? "▲" : "▼"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Autoridade</span>
                  <AuthorityBar value={src.authority} />
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: "0.625rem 0.75rem", borderTop: "1px solid #f3f4f6", background: "#fafafa" }}>
                  <p style={{ fontSize: "0.8125rem", color: "#374151", fontStyle: "italic", margin: 0 }}>"{src.excerpt}"</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
