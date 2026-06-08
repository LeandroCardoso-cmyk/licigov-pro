import React from "react";

interface Props {
  sessionId?: string;
  documentType?: string;
}

const MOCK_VARIABLES = [
  { name: "ORGAO_NOME", resolved: true, value: "Ministério da Gestão e Inovação" },
  { name: "OBJETO_DESCRICAO", resolved: true, value: "Serviços de suporte técnico de TI" },
  { name: "VALOR_ESTIMADO", resolved: true, value: "R$ 480.000,00" },
  { name: "PRAZO_VIGENCIA", resolved: true, value: "12 meses" },
  { name: "MODALIDADE", resolved: true, value: "Pregão Eletrônico" },
  { name: "CRITERIO_JULGAMENTO", resolved: false, value: null },
  { name: "FISCAL_CONTRATO", resolved: false, value: null },
  { name: "DATA_PUBLICACAO", resolved: false, value: null },
];

const COMPLETENESS_SCORE = 0.85;

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  edital_pregao: "Edital de Pregão Eletrônico",
  termo_referencia: "Termo de Referência",
  estudo_tecnico: "Estudo Técnico Preliminar",
  contrato: "Contrato Administrativo",
};

const PREVIEW_TEXT = `EDITAL DE PREGÃO ELETRÔNICO Nº {{DATA_PUBLICACAO}}/2024

OBJETO: Contratação de empresa especializada para prestação de serviços de suporte
técnico e manutenção de infraestrutura de TI pelo período de 12 (doze) meses.

ÓRGÃO: Ministério da Gestão e Inovação em Serviços Públicos

MODALIDADE: Pregão Eletrônico – Menor Preço Global

VALOR ESTIMADO: R$ 480.000,00

CRITÉRIO DE JULGAMENTO: {{CRITERIO_JULGAMENTO}}

FISCAL DO CONTRATO: {{FISCAL_CONTRATO}}

A proposta deverá ser apresentada conforme modelo constante no Anexo I deste Edital...`;

export default function DraftGenerationPanel({ sessionId = "demo", documentType = "edital_pregao" }: Props) {
  const completenessScore = COMPLETENESS_SCORE;
  const completePct = Math.round(completenessScore * 100);
  const completenessColor = completePct >= 80 ? "#10b981" : completePct >= 60 ? "#f59e0b" : "#ef4444";

  const resolvedCount = MOCK_VARIABLES.filter(v => v.resolved).length;
  const pendingCount = MOCK_VARIABLES.filter(v => !v.resolved).length;
  const docTypeLabel = DOCUMENT_TYPE_LABELS[documentType] ?? documentType;

  const renderPreview = (text: string) => {
    const parts = text.split(/(\{\{[A-Z_]+\}\})/g);
    return parts.map((part, i) => {
      if (/^\{\{[A-Z_]+\}\}$/.test(part)) {
        return (
          <span key={i} style={{ background: "#fef3c7", color: "#92400e", borderRadius: "3px", padding: "0 3px", fontFamily: "monospace", fontSize: "0.75rem" }}>
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Geração de Rascunho</h2>
        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
      </div>

      {/* Document type */}
      <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #e5e7eb" }}>
        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Tipo de Documento</div>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#1d4ed8" }}>{docTypeLabel}</div>
      </div>

      {/* Completeness */}
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.375rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "#374151" }}>Completude</span>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: completenessColor }}>{completePct}%</span>
        </div>
        <div style={{ height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${completePct}%`, background: completenessColor, transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Variables */}
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", margin: 0 }}>Variáveis</h3>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "#ecfdf5", color: "#10b981", fontWeight: 600 }}>
              {resolvedCount} resolvidas
            </span>
            <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
              {pendingCount} pendentes
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {MOCK_VARIABLES.map((v, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.375rem 0.5rem", borderRadius: "0.375rem", background: v.resolved ? "#f0fdf4" : "#fffbeb", border: `1px solid ${v.resolved ? "#bbf7d0" : "#fde68a"}` }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#374151" }}>{v.name}</span>
              {v.resolved ? (
                <span style={{ fontSize: "0.75rem", color: "#15803d" }}>{v.value}</span>
              ) : (
                <span style={{ fontSize: "0.75rem", color: "#92400e", fontStyle: "italic" }}>pendente</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={() => {}}
        style={{ width: "100%", padding: "0.625rem", background: "#1d4ed8", color: "white", border: "none", borderRadius: "0.375rem", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer", marginBottom: "1rem" }}
      >
        Gerar Rascunho
      </button>

      {/* Preview */}
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>Preview do Documento</h3>
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem", fontFamily: "monospace", fontSize: "0.8125rem", color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: "200px", overflow: "auto" }}>
          {renderPreview(PREVIEW_TEXT)}
        </div>
      </div>
    </div>
  );
}
