import React, { useState } from "react";

interface GroundingEvidence {
  id: string;
  sourceRef: string;
  content: string;
  relevanceScore: number;
  evidenceType: "document" | "regulation" | "precedent" | "knowledge_base" | "user_input";
  legalBasis?: string;
  citationKey: string;
  verified: boolean;
  verifiedAt?: string;
}

interface GroundingResult {
  id: string;
  aiContent: string;
  groundedContent: string;
  evidenceRefs: GroundingEvidence[];
  hallucinationRisk: "low" | "medium" | "high";
  confidence: number;
  ungroundedClaims: string[];
  groundedClaims: string[];
  processedAt: string;
}

interface GroundingEvidencePanelProps {
  result?: GroundingResult;
  onVerifyEvidence?: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  document:       "Documento",
  regulation:     "Regulação",
  precedent:      "Precedente",
  knowledge_base: "Base de conhecimento",
  user_input:     "Entrada do usuário",
};

const RISK_COLORS = { low: "#10b981", medium: "#f59e0b", high: "#ef4444" };
const RISK_LABELS = { low: "Baixo", medium: "Médio", high: "Alto" };

export function GroundingEvidencePanel({ result, onVerifyEvidence }: GroundingEvidencePanelProps) {
  const [tab, setTab] = useState<"evidence" | "grounded" | "ungrounded">("evidence");

  if (!result) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "1rem", textAlign: "center", color: "#9ca3af" }}>
        Nenhum resultado de fundamentação disponível.
      </div>
    );
  }

  const confidencePercent = Math.round(result.confidence * 100);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Painel de Fundamentação (Grounding)
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: RISK_COLORS[result.hallucinationRisk] }}>
            {RISK_LABELS[result.hallucinationRisk]}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>Risco de alucinação</div>
        </div>
        <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: confidencePercent >= 80 ? "#10b981" : confidencePercent >= 50 ? "#f59e0b" : "#ef4444" }}>
            {confidencePercent}%
          </div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>Confiança</div>
        </div>
        <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{result.evidenceRefs.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>Evidências</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0", marginBottom: "1rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
        {(["evidence", "grounded", "ungrounded"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "0.5rem", border: "none", cursor: "pointer",
              background: tab === t ? "#3b82f6" : "white",
              color: tab === t ? "white" : "#374151", fontSize: "0.8125rem", fontWeight: 500
            }}
          >
            {t === "evidence" ? `Evidências (${result.evidenceRefs.length})` : t === "grounded" ? `Afirmações sustentadas (${result.groundedClaims.length})` : `Sem sustentação (${result.ungroundedClaims.length})`}
          </button>
        ))}
      </div>

      {tab === "evidence" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {result.evidenceRefs.map(ev => (
            <div key={ev.id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{ev.citationKey}</span>
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#6b7280" }}>{TYPE_LABELS[ev.evidenceType] ?? ev.evidenceType}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{Math.round(ev.relevanceScore * 100)}% relevância</span>
                  {ev.verified ? (
                    <span style={{ fontSize: "0.75rem", color: "#10b981" }}>✓ Verificado</span>
                  ) : onVerifyEvidence && (
                    <button onClick={() => onVerifyEvidence(ev.id)} style={{ fontSize: "0.75rem", color: "#3b82f6", border: "none", background: "none", cursor: "pointer" }}>
                      Verificar
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: "0.8125rem", color: "#374151" }}>{ev.sourceRef}</div>
              {ev.legalBasis && <div style={{ fontSize: "0.75rem", color: "#8b5cf6", marginTop: "0.25rem" }}>Lei: {ev.legalBasis}</div>}
              <div style={{ fontSize: "0.8125rem", color: "#6b7280", marginTop: "0.25rem", fontStyle: "italic" }}>"{ev.content.slice(0, 120)}{ev.content.length > 120 ? "..." : ""}"</div>
            </div>
          ))}
        </div>
      )}

      {tab === "grounded" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {result.groundedClaims.length === 0 ? (
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "1.5rem" }}>Nenhuma afirmação sustentada.</div>
          ) : result.groundedClaims.map((claim, idx) => (
            <div key={idx} style={{ padding: "0.5rem 0.75rem", background: "#ecfdf5", borderRadius: "0.375rem", fontSize: "0.8125rem", borderLeft: "3px solid #10b981" }}>
              {claim}
            </div>
          ))}
        </div>
      )}

      {tab === "ungrounded" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {result.ungroundedClaims.length === 0 ? (
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "1.5rem" }}>Nenhuma afirmação sem sustentação.</div>
          ) : result.ungroundedClaims.map((claim, idx) => (
            <div key={idx} style={{ padding: "0.5rem 0.75rem", background: "#fef2f2", borderRadius: "0.375rem", fontSize: "0.8125rem", borderLeft: "3px solid #ef4444" }}>
              ⚠️ {claim}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
