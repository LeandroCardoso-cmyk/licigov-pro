import React from "react";

interface Props {
  sessionId?: string;
  organizationId?: number;
}

type ForceType = "Binding" | "Persuasivo" | "Informativo";

interface Precedent {
  id: string;
  tribunal: string;
  numero: string;
  ano: string;
  tipo: string;
  force: ForceType;
  summary: string;
  citation: string;
  correlationScore: number;
}

const MOCK_PRECEDENTS: Precedent[] = [
  {
    id: "p1",
    tribunal: "TCU",
    numero: "2089",
    ano: "2021",
    tipo: "Acórdão",
    force: "Binding",
    summary: "Estabelece critérios mínimos para pesquisa de preços em contratações públicas. Exige no mínimo três fontes independentes e prevê métodos alternativos quando inviável.",
    citation: "TCU, Acórdão 2089/2021, Plenário, Rel. Min. Vital do Rêgo.",
    correlationScore: 0.94,
  },
  {
    id: "p2",
    tribunal: "TCU",
    numero: "1472",
    ano: "2022",
    tipo: "Acórdão",
    force: "Binding",
    summary: "Define os requisitos para dispensa de licitação e obrigatoriedade de documentação do processo administrativo. Reforça necessidade de DFD e ETP quando aplicável.",
    citation: "TCU, Acórdão 1472/2022, Plenário, Rel. Min. Jorge Oliveira.",
    correlationScore: 0.88,
  },
  {
    id: "p3",
    tribunal: "TCU",
    numero: "876",
    ano: "2023",
    tipo: "Acórdão",
    force: "Persuasivo",
    summary: "Trata da vigência contratual e prorrogações. Esclarece que prorrogações acima de 12 meses exigem justificativa técnica fundamentada.",
    citation: "TCU, Acórdão 876/2023, 2ª Câmara, Rel. Min. Ana Arraes.",
    correlationScore: 0.76,
  },
  {
    id: "p4",
    tribunal: "TCU",
    numero: "177",
    ano: "—",
    tipo: "Súmula",
    force: "Binding",
    summary: "Veda a exigência de garantia de proposta em certames licitatórios nos casos em que a lei não a autoriza expressamente, sob pena de restrição à competitividade.",
    citation: "TCU, Súmula 177.",
    correlationScore: 0.65,
  },
];

const CORRELATION_SCORE = 0.72;

const FORCE_CONFIG: Record<ForceType, { color: string; bg: string }> = {
  Binding:    { color: "#1d4ed8", bg: "#dbeafe" },
  Persuasivo: { color: "#7c3aed", bg: "#ede9fe" },
  Informativo: { color: "#6b7280", bg: "#f3f4f6" },
};

export default function JurisprudenceExplorer({ sessionId = "demo", organizationId = 1 }: Props) {
  const corrPct = Math.round(CORRELATION_SCORE * 100);
  const corrColor = CORRELATION_SCORE >= 0.7 ? "#10b981" : CORRELATION_SCORE >= 0.5 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Explorador de Jurisprudência</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {/* Correlation score */}
      <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "#374151" }}>Score de Correlação Jurisprudencial</span>
          <span style={{ fontSize: "1rem", fontWeight: 700, color: corrColor }}>{corrPct}%</span>
        </div>
        <div style={{ height: "7px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${corrPct}%`, background: corrColor }} />
        </div>
        <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.375rem" }}>
          {MOCK_PRECEDENTS.length} precedentes relevantes encontrados
        </div>
      </div>

      {/* Precedent list */}
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>
          Precedentes Relevantes
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {MOCK_PRECEDENTS.map(p => {
            const forceCfg = FORCE_CONFIG[p.force];
            const scoreColor = p.correlationScore >= 0.8 ? "#10b981" : p.correlationScore >= 0.6 ? "#f59e0b" : "#ef4444";
            return (
              <div key={p.id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem", background: "white", borderLeft: "3px solid #1d4ed8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.375rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#111827" }}>
                      {p.tipo} {p.numero}/{p.ano}
                    </span>
                    <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: "#dbeafe", color: "#1d4ed8", fontWeight: 600 }}>
                      {p.tribunal}
                    </span>
                    <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: forceCfg.bg, color: forceCfg.color, fontWeight: 600 }}>
                      {p.force}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
                    <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Corr.</span>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: scoreColor }}>{Math.round(p.correlationScore * 100)}%</span>
                  </div>
                </div>
                <p style={{ fontSize: "0.8125rem", color: "#374151", margin: "0 0 0.5rem", lineHeight: 1.5 }}>{p.summary}</p>
                <div style={{ background: "#f9fafb", borderRadius: "0.375rem", padding: "0.375rem 0.5rem", border: "1px solid #e5e7eb" }}>
                  <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6b7280" }}>Citação: </span>
                  <span style={{ fontSize: "0.7rem", color: "#374151", fontStyle: "italic" }}>{p.citation}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
