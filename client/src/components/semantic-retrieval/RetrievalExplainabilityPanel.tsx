import React, { useState } from "react";

interface TraceStep {
  step: number;
  label: string;
  detail: string;
  durationMs: number;
  status: "success" | "skipped" | "warning";
}

interface RetrievalTrace {
  id: string;
  query: string;
  humanSummary: string;
  traceSteps: TraceStep[];
  confidence: number;
  totalDurationMs: number;
  retrievedAt: string;
}

interface RetrievalExplainabilityPanelProps {
  organizationId: number;
}

const MOCK_TRACES: RetrievalTrace[] = [
  {
    id: "trace-001",
    query: "requisitos de habilitação pregão eletrônico",
    humanSummary: "A consulta foi interpretada como busca por documentos sobre requisitos de habilitação em processos de pregão eletrônico. O sistema expandiu os sinônimos ('habilitação' → 'qualificação', 'documentação'), corrigiu variações ortográficas e combinou estratégias léxica e semântica, priorizando documentos recentes da organização.",
    confidence: 0.89,
    totalDurationMs: 142,
    retrievedAt: "2024-12-10T10:30:00Z",
    traceSteps: [
      { step: 1, label: "Pré-processamento da consulta", detail: "Tokenização, normalização e remoção de stopwords. Consulta original: 7 tokens → 5 tokens efetivos.", durationMs: 3, status: "success" },
      { step: 2, label: "Correção de typos", detail: "Nenhum erro ortográfico detectado. Consulta mantida sem alterações.", durationMs: 2, status: "success" },
      { step: 3, label: "Expansão de sinônimos", detail: "Expandido: 'habilitação' → ['qualificação', 'documentação fiscal', 'certidões']; 'pregão' → ['licitação', 'processo licitatório'].", durationMs: 8, status: "success" },
      { step: 4, label: "Busca léxica (BM25)", detail: "Indexação invertida executada. 23 documentos candidatos retornados com score > 0.3.", durationMs: 18, status: "success" },
      { step: 5, label: "Busca semântica (vetorial)", detail: "Embedding gerado (1536 dimensões). Similaridade cosseno calculada. 18 documentos candidatos retornados.", durationMs: 67, status: "success" },
      { step: 6, label: "Fusão de resultados (RRF)", detail: "Reciprocal Rank Fusion aplicado. Pesos: léxico=0.4, semântico=0.6. 15 documentos mesclados.", durationMs: 5, status: "success" },
      { step: 7, label: "Re-ranqueamento contextual", detail: "Contexto organizacional aplicado. Documentos recentes receberam boost de 1.15x. 5 documentos finais selecionados.", durationMs: 39, status: "success" },
    ],
  },
];

const STEP_STATUS_COLORS: Record<string, string> = {
  success: "#10b981",
  skipped: "#9ca3af",
  warning: "#f59e0b",
};

export default function RetrievalExplainabilityPanel({ organizationId }: RetrievalExplainabilityPanelProps) {
  const [selectedTrace] = useState<RetrievalTrace>(MOCK_TRACES[0]);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const trace = selectedTrace;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Explicabilidade da Recuperação
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
        <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: trace.confidence > 0.8 ? "#10b981" : "#f59e0b" }}>
            {Math.round(trace.confidence * 100)}%
          </div>
          <div style={{ fontSize: "0.6875rem", color: "#6b7280" }}>confiança</div>
        </div>
      </div>

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#1d4ed8", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Resumo em linguagem natural
        </div>
        <div style={{ fontSize: "0.8125rem", color: "#1e3a5f", lineHeight: 1.6 }}>
          {trace.humanSummary}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151" }}>
          Passos do pipeline ({trace.traceSteps.length})
        </div>
        <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
          Total: {trace.totalDurationMs}ms
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        {trace.traceSteps.map(step => (
          <div
            key={step.step}
            style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}
          >
            <div
              onClick={() => setExpandedStep(expandedStep === step.step ? null : step.step)}
              style={{
                padding: "0.5rem 0.75rem", cursor: "pointer", display: "flex",
                justifyContent: "space-between", alignItems: "center",
                borderLeft: `4px solid ${STEP_STATUS_COLORS[step.status]}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{
                  width: "1.5rem", height: "1.5rem", borderRadius: "50%",
                  background: STEP_STATUS_COLORS[step.status], color: "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.6875rem", fontWeight: 700, flexShrink: 0,
                }}>
                  {step.step}
                </span>
                <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{step.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexShrink: 0 }}>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{step.durationMs}ms</span>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{expandedStep === step.step ? "▲" : "▼"}</span>
              </div>
            </div>
            {expandedStep === step.step && (
              <div style={{ padding: "0.625rem 0.75rem", borderTop: "1px solid #f3f4f6", background: "#fafafa", fontSize: "0.8125rem", color: "#6b7280", lineHeight: 1.5 }}>
                {step.detail}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
