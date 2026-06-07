import React, { useState } from "react";

type ReasoningType = "deductive" | "analogical" | "precedent" | "synthesis";

interface ReasoningStage {
  id: string;
  type: ReasoningType;
  label: string;
  confidenceScore: number;
  output: string;
  children: ReasoningStage[];
}

interface Contradiction {
  a: string;
  b: string;
  description: string;
}

interface Ambiguity {
  point: string;
  options: string[];
}

interface ReasoningResult {
  stages: ReasoningStage[];
  contradictions: Contradiction[];
  ambiguities: Ambiguity[];
  overallConfidence: number;
  conclusion: string;
}

interface AIReasoningTreeProps {
  organizationId: number;
}

const TYPE_CONFIG: Record<ReasoningType, { label: string; color: string; bg: string }> = {
  deductive:  { label: "Dedutivo",   color: "#1d4ed8", bg: "#dbeafe" },
  analogical: { label: "Analógico",  color: "#7c3aed", bg: "#ede9fe" },
  precedent:  { label: "Precedente", color: "#b45309", bg: "#fef3c7" },
  synthesis:  { label: "Síntese",    color: "#065f46", bg: "#d1fae5" },
};

const MOCK_RESULT: ReasoningResult = {
  stages: [
    {
      id: "r1",
      type: "deductive",
      label: "Análise de Enquadramento Legal",
      confidenceScore: 0.94,
      output: "O contrato se enquadra no art. 75, II da Lei 14.133/2021 por atender ao critério de valor (R$ 57.200,00 < R$ 59.906,02) e natureza de serviço comum.",
      children: [
        {
          id: "r1a",
          type: "precedent",
          label: "Verificação de Precedentes TCU",
          confidenceScore: 0.88,
          output: "Acórdão 2.622/2015-Plenário confirma aplicabilidade da dispensa para serviços de manutenção predial sem características especializadas.",
          children: [],
        },
      ],
    },
    {
      id: "r2",
      type: "analogical",
      label: "Comparação com Casos Similares",
      confidenceScore: 0.79,
      output: "Três dispensas similares aprovadas pela mesma UG nos últimos 24 meses sem ressalvas do controle interno. Padrão consistente.",
      children: [],
    },
    {
      id: "r3",
      type: "synthesis",
      label: "Síntese de Riscos",
      confidenceScore: 0.86,
      output: "Riscos identificados: (1) ausência de orçamento detalhado, (2) prazo de vigência supera 12 meses sem justificativa explícita.",
      children: [],
    },
    {
      id: "r4",
      type: "deductive",
      label: "Conclusão de Conformidade",
      confidenceScore: 0.91,
      output: "Contratação é legal e regular, sujeita a ajustes: incluir planilha orçamentária e motivação para vigência estendida.",
      children: [],
    },
  ],
  contradictions: [
    {
      a: "Prazo de 14 meses (Cláusula 3ª)",
      b: "Art. 106 Lei 14.133 — vigência máxima de 12 meses para serviços contínuos sem justificativa",
      description: "O prazo contratual diverge do limite legal sem motivação documentada.",
    },
  ],
  ambiguities: [
    {
      point: "Critério de aceitação dos serviços",
      options: ["Inspeção visual por fiscal designado", "Relatório técnico de empresa credenciada"],
    },
  ],
  overallConfidence: 0.89,
  conclusion: "A dispensa é legalmente fundamentada. Recomenda-se corrigir a vigência ou incluir justificativa expressa conforme art. 106, § 2º da Lei 14.133/2021.",
};

function StageNode({ stage, depth }: { stage: ReasoningStage; depth: number }) {
  const [open, setOpen] = useState(true);
  const cfg = TYPE_CONFIG[stage.type];
  const hasChildren = stage.children.length > 0;

  return (
    <div style={{ marginLeft: depth > 0 ? "1.25rem" : "0" }}>
      <div style={{ borderLeft: depth > 0 ? "2px solid #e5e7eb" : "none", paddingLeft: depth > 0 ? "0.75rem" : "0" }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden", marginBottom: "0.375rem" }}>
          <div
            onClick={() => setOpen(o => !o)}
            style={{ padding: "0.5rem 0.75rem", cursor: "pointer", background: "#f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {hasChildren && <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{open ? "▼" : "▶"}</span>}
              <span style={{ fontSize: "0.75rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: cfg.bg, color: cfg.color, fontWeight: 600 }}>
                {cfg.label}
              </span>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{stage.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <div style={{ width: "40px", height: "5px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round(stage.confidenceScore * 100)}%`, background: stage.confidenceScore >= 0.85 ? "#10b981" : stage.confidenceScore >= 0.65 ? "#f59e0b" : "#ef4444" }} />
              </div>
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{Math.round(stage.confidenceScore * 100)}%</span>
            </div>
          </div>
          {open && (
            <div style={{ padding: "0.5rem 0.75rem", background: "white", borderTop: "1px solid #f3f4f6" }}>
              <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0 }}>
                {stage.output.length > 160 ? `${stage.output.slice(0, 160)}…` : stage.output}
              </p>
            </div>
          )}
        </div>

        {open && stage.children.map(child => (
          <StageNode key={child.id} stage={child} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

export default function AIReasoningTree({ organizationId: _organizationId }: AIReasoningTreeProps) {
  const result = MOCK_RESULT;
  const confidencePct = Math.round(result.overallConfidence * 100);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "1rem" }}>Árvore de Raciocínio IA</h2>

      <div style={{ marginBottom: "1rem" }}>
        {result.stages.map(stage => (
          <StageNode key={stage.id} stage={stage} depth={0} />
        ))}
      </div>

      {result.contradictions.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#ef4444", marginBottom: "0.375rem" }}>
            Contradições Detectadas ({result.contradictions.length})
          </h3>
          {result.contradictions.map((c, idx) => (
            <div key={idx} style={{ padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", marginBottom: "0.25rem" }}>
              <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#991b1b", marginBottom: "0.25rem" }}>{c.description}</div>
              <div style={{ fontSize: "0.75rem", color: "#374151" }}>
                <span style={{ fontWeight: 600 }}>A:</span> {c.a}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#374151", marginTop: "0.125rem" }}>
                <span style={{ fontWeight: 600 }}>B:</span> {c.b}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.ambiguities.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#f59e0b", marginBottom: "0.375rem" }}>
            Ambiguidades ({result.ambiguities.length})
          </h3>
          {result.ambiguities.map((a, idx) => (
            <div key={idx} style={{ padding: "0.625rem 0.75rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.5rem", marginBottom: "0.25rem" }}>
              <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#92400e", marginBottom: "0.25rem" }}>{a.point}</div>
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                {a.options.map((opt, oi) => (
                  <span key={oi} style={{ fontSize: "0.75rem", padding: "0.1rem 0.375rem", background: "white", border: "1px solid #fde68a", borderRadius: "9999px", color: "#78350f" }}>
                    {opt}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "0.875rem", background: confidencePct >= 80 ? "#ecfdf5" : "#fffbeb", border: `1px solid ${confidencePct >= 80 ? "#a7f3d0" : "#fde68a"}`, borderRadius: "0.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
          <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "#111827" }}>Conclusão Final</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Confiança geral:</span>
            <span style={{ fontWeight: 700, color: confidencePct >= 80 ? "#10b981" : "#f59e0b" }}>{confidencePct}%</span>
          </div>
        </div>
        <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0 }}>{result.conclusion}</p>
      </div>
    </div>
  );
}
