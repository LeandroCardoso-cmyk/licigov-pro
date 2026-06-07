import React, { useState } from "react";

interface ProvenanceInfo {
  sourceDocument: string;
  sourceSection: string;
  capturedAt: string;
}

interface EvidenceChain {
  id: string;
  chainType: "regulatory" | "jurisprudential" | "contractual" | "normative";
  totalLinks: number;
  confidence: number;
  isSuperseded: boolean;
  supersededBy?: string;
  provenance: ProvenanceInfo;
  summary: string;
}

interface EvidencePanelProps {
  organizationId: number;
}

const MOCK_CHAINS: EvidenceChain[] = [
  {
    id: "ec-001",
    chainType: "regulatory",
    totalLinks: 5,
    confidence: 0.92,
    isSuperseded: false,
    provenance: { sourceDocument: "Lei 14.133/2021", sourceSection: "Art. 92 — Dispensa de Licitação", capturedAt: "2024-11-15T08:30:00Z" },
    summary: "Cadeia regulatória para dispensa de licitação em tecnologia da informação — fundamentada na nova Lei de Licitações.",
  },
  {
    id: "ec-002",
    chainType: "jurisprudential",
    totalLinks: 3,
    confidence: 0.78,
    isSuperseded: false,
    provenance: { sourceDocument: "Acórdão TCU 1234/2024", sourceSection: "Item 9.3 — Determinações", capturedAt: "2024-10-20T14:15:00Z" },
    summary: "Precedente do TCU sobre exigências de qualificação técnica em contratos de TI.",
  },
  {
    id: "ec-003",
    chainType: "normative",
    totalLinks: 7,
    confidence: 0.85,
    isSuperseded: true,
    supersededBy: "ec-005",
    provenance: { sourceDocument: "IN SEGES 65/2021", sourceSection: "Capítulo III", capturedAt: "2024-01-10T11:00:00Z" },
    summary: "Normativa anterior sobre formalização de contratos — substituída por instrução mais recente.",
  },
  {
    id: "ec-004",
    chainType: "contractual",
    totalLinks: 4,
    confidence: 0.88,
    isSuperseded: false,
    provenance: { sourceDocument: "Contrato 12/2024", sourceSection: "Cláusula 8ª — Penalidades", capturedAt: "2024-12-01T09:00:00Z" },
    summary: "Cadeia contratual de penalidades aplicáveis por inadimplemento de cláusulas de SLA.",
  },
];

const CHAIN_TYPE_COLORS: Record<string, string> = {
  regulatory:     "#3b82f6",
  jurisprudential: "#8b5cf6",
  contractual:    "#10b981",
  normative:      "#f59e0b",
};

const CHAIN_TYPE_LABELS: Record<string, string> = {
  regulatory:     "Regulatória",
  jurisprudential: "Jurisprudencial",
  contractual:    "Contratual",
  normative:      "Normativa",
};

export default function EvidencePanel({ organizationId }: EvidencePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeChains = MOCK_CHAINS.filter(c => !c.isSuperseded);
  const supersededCount = MOCK_CHAINS.filter(c => c.isSuperseded).length;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Cadeias de Evidência
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div style={{ background: "#d1fae5", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#065f46" }}>{activeChains.length}</div>
            <div style={{ fontSize: "0.6875rem", color: "#065f46" }}>ativas</div>
          </div>
          <div style={{ background: "#fee2e2", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#991b1b" }}>{supersededCount}</div>
            <div style={{ fontSize: "0.6875rem", color: "#991b1b" }}>superadas</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {MOCK_CHAINS.map(chain => (
          <div
            key={chain.id}
            style={{
              border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden",
              opacity: chain.isSuperseded ? 0.65 : 1,
            }}
          >
            <div
              onClick={() => setExpandedId(expandedId === chain.id ? null : chain.id)}
              style={{
                padding: "0.625rem 0.75rem", cursor: "pointer", display: "flex",
                justifyContent: "space-between", alignItems: "center",
                borderLeft: `4px solid ${CHAIN_TYPE_COLORS[chain.chainType]}`,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{CHAIN_TYPE_LABELS[chain.chainType]}</span>
                  <span style={{
                    fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px",
                    background: CHAIN_TYPE_COLORS[chain.chainType], color: "white",
                  }}>
                    {chain.totalLinks} link{chain.totalLinks !== 1 ? "s" : ""}
                  </span>
                  {chain.isSuperseded && (
                    <span style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px", background: "#fee2e2", color: "#991b1b" }}>
                      Superada
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.125rem" }}>
                  {chain.provenance.sourceDocument}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
                <div>
                  <div style={{ width: "48px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${chain.confidence * 100}%`, background: chain.confidence > 0.8 ? "#10b981" : chain.confidence > 0.6 ? "#f59e0b" : "#ef4444" }} />
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "#6b7280", textAlign: "right" }}>
                    {Math.round(chain.confidence * 100)}%
                  </div>
                </div>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{expandedId === chain.id ? "▲" : "▼"}</span>
              </div>
            </div>

            {expandedId === chain.id && (
              <div style={{ padding: "0.75rem", borderTop: "1px solid #f3f4f6", background: "#fafafa" }}>
                <div style={{ fontSize: "0.8125rem", color: "#374151", marginBottom: "0.5rem" }}>
                  {chain.summary}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.75rem", color: "#6b7280" }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>Seção:</span> {chain.provenance.sourceSection}
                  </div>
                  <div>
                    <span style={{ fontWeight: 600 }}>Capturado em:</span> {new Date(chain.provenance.capturedAt).toLocaleDateString("pt-BR")}
                  </div>
                  {chain.isSuperseded && chain.supersededBy && (
                    <div style={{ color: "#991b1b" }}>
                      <span style={{ fontWeight: 600 }}>Substituída por:</span> {chain.supersededBy}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
