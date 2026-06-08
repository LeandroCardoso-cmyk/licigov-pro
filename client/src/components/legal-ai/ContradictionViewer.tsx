import React from "react";

interface Props {
  sessionId?: string;
  organizationId?: number;
}

type Severity = "critical" | "high" | "medium" | "low";

interface Contradiction {
  id: string;
  premisseA: string;
  premisseB: string;
  severity: Severity;
  description: string;
  resolution: string;
}

const MOCK_CONTRADICTIONS: Contradiction[] = [];

// Uncomment to test with contradictions:
// const MOCK_CONTRADICTIONS: Contradiction[] = [
//   {
//     id: "c1",
//     premisseA: "Lei 14133/2021 art. 75 — Dispensa permitida até o limite de R$ 57.200",
//     premisseB: "Decreto interno 005/2023 — Limite interno de R$ 30.000 para dispensa",
//     severity: "high",
//     description: "Conflito entre norma federal e normativo interno sobre limite de dispensa de licitação.",
//     resolution: "Aplicar o normativo interno mais restritivo enquanto não houver revisão pelo órgão competente.",
//   },
// ];

const SEVERITY_CONFIG: Record<Severity, { color: string; bg: string; label: string }> = {
  critical: { color: "#ef4444", bg: "#fef2f2", label: "Crítica" },
  high:     { color: "#f97316", bg: "#fff7ed", label: "Alta" },
  medium:   { color: "#f59e0b", bg: "#fffbeb", label: "Média" },
  low:      { color: "#10b981", bg: "#ecfdf5", label: "Baixa" },
};

export default function ContradictionViewer({ sessionId = "demo", organizationId = 1 }: Props) {
  const count = MOCK_CONTRADICTIONS.length;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Contradições Detectadas</h2>
          {count > 0 && (
            <span style={{ fontSize: "0.75rem", padding: "0.15rem 0.625rem", borderRadius: "9999px", background: "#ef4444", color: "white", fontWeight: 700 }}>
              {count}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {count === 0 ? (
        <div style={{ padding: "1.25rem", background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "1.5rem" }}>✓</span>
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#065f46" }}>Nenhuma contradição detectada</div>
            <div style={{ fontSize: "0.8125rem", color: "#047857", marginTop: "0.125rem" }}>
              As premissas jurídicas identificadas são consistentes entre si.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem", color: "#7f1d1d" }}>
            {count} contradição{count !== 1 ? "ões" : ""} detectada{count !== 1 ? "s" : ""} — revisão manual recomendada.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {MOCK_CONTRADICTIONS.map(c => {
              const cfg = SEVERITY_CONFIG[c.severity];
              return (
                <div key={c.id} style={{ border: `1px solid ${cfg.color}`, borderRadius: "0.5rem", overflow: "hidden" }}>
                  <div style={{ padding: "0.625rem 0.75rem", background: cfg.bg }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "white", color: cfg.color, fontWeight: 700, border: `1px solid ${cfg.color}` }}>
                        Severidade: {cfg.label}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.375rem" }}>
                      <span style={{ fontSize: "0.75rem", background: "white", border: `1px solid ${cfg.color}`, borderRadius: "0.375rem", padding: "0.25rem 0.5rem", color: "#374151", flex: 1, minWidth: "120px" }}>
                        {c.premisseA}
                      </span>
                      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: cfg.color, flexShrink: 0 }}>vs</span>
                      <span style={{ fontSize: "0.75rem", background: "white", border: `1px solid ${cfg.color}`, borderRadius: "0.375rem", padding: "0.25rem 0.5rem", color: "#374151", flex: 1, minWidth: "120px" }}>
                        {c.premisseB}
                      </span>
                    </div>
                    <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0 }}>{c.description}</p>
                  </div>
                  <div style={{ padding: "0.5rem 0.75rem", background: "white", borderTop: `1px solid ${cfg.color}` }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151" }}>Resolução proposta: </span>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{c.resolution}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
