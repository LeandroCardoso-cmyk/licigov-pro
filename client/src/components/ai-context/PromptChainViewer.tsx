import React, { useState } from "react";

type StageType = "system" | "context" | "reasoning" | "output";

interface ChainStage {
  id: string;
  name: string;
  type: StageType;
  dependencies: string[];
  maxTokens: number;
  description: string;
}

interface ChainTransition {
  from: string;
  to: string;
  condition: string;
}

interface PromptChain {
  id: string;
  name: string;
  stages: ChainStage[];
  transitions: ChainTransition[];
}

interface PromptChainViewerProps {
  organizationId: number;
}

const STAGE_TYPE_COLORS: Record<StageType, string> = {
  system:    "#8b5cf6",
  context:   "#3b82f6",
  reasoning: "#f59e0b",
  output:    "#10b981",
};

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  system:    "Sistema",
  context:   "Contexto",
  reasoning: "Raciocínio",
  output:    "Saída",
};

const MOCK_CHAIN: PromptChain = {
  id: "chain-licitacao-analise",
  name: "Análise de Licitação — Cadeia Principal",
  stages: [
    {
      id: "s1",
      name: "Inicialização do Sistema",
      type: "system",
      dependencies: [],
      maxTokens: 1024,
      description: "Define persona, restrições legais e parâmetros de comportamento do modelo.",
    },
    {
      id: "s2",
      name: "Montagem de Contexto",
      type: "context",
      dependencies: ["s1"],
      maxTokens: 4096,
      description: "Injeta fragmentos legais, histórico de sessão e documentos relevantes.",
    },
    {
      id: "s3",
      name: "Cadeia de Raciocínio",
      type: "reasoning",
      dependencies: ["s1", "s2"],
      maxTokens: 2048,
      description: "Chain-of-thought para análise de conformidade e identificação de riscos.",
    },
    {
      id: "s4",
      name: "Geração de Saída",
      type: "output",
      dependencies: ["s3"],
      maxTokens: 1536,
      description: "Formata o resultado final com citações, recomendações e score de risco.",
    },
  ],
  transitions: [
    { from: "s1", to: "s2", condition: "sistema inicializado com sucesso" },
    { from: "s2", to: "s3", condition: "contexto montado e validado" },
    { from: "s3", to: "s4", condition: "raciocínio concluído sem contradições" },
  ],
};

export default function PromptChainViewer({ organizationId: _organizationId }: PromptChainViewerProps) {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const chain = MOCK_CHAIN;

  const transitionMap = chain.transitions.reduce<Record<string, ChainTransition>>((acc, t) => {
    acc[t.from] = t;
    return acc;
  }, {});

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>Visualizador de Chain de Prompts</h2>
      <p style={{ fontSize: "0.8125rem", color: "#6b7280", marginBottom: "1rem", marginTop: 0 }}>{chain.name}</p>

      <div style={{ display: "flex", alignItems: "flex-start", gap: "0", overflowX: "auto", paddingBottom: "0.5rem", marginBottom: "1.25rem" }}>
        {chain.stages.map((stage, idx) => (
          <React.Fragment key={stage.id}>
            <div
              onClick={() => setSelectedStage(selectedStage === stage.id ? null : stage.id)}
              style={{
                flexShrink: 0,
                width: "130px",
                padding: "0.625rem",
                border: `2px solid ${STAGE_TYPE_COLORS[stage.type]}`,
                borderRadius: "0.5rem",
                cursor: "pointer",
                background: selectedStage === stage.id ? STAGE_TYPE_COLORS[stage.type] : "white",
                transition: "background 0.15s",
              }}
            >
              <div style={{ fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.25rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: selectedStage === stage.id ? "rgba(255,255,255,0.25)" : STAGE_TYPE_COLORS[stage.type], color: selectedStage === stage.id ? "white" : "white", display: "inline-block" }}>
                {STAGE_TYPE_LABELS[stage.type]}
              </div>
              <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: selectedStage === stage.id ? "white" : "#111827", marginTop: "0.25rem" }}>{stage.name}</div>
              <div style={{ fontSize: "0.75rem", color: selectedStage === stage.id ? "rgba(255,255,255,0.8)" : "#9ca3af", marginTop: "0.25rem" }}>
                max {stage.maxTokens.toLocaleString()} tk
              </div>
            </div>

            {idx < chain.stages.length - 1 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 0.25rem", minWidth: "64px", flexShrink: 0 }}>
                <div style={{ fontSize: "0.7rem", color: "#9ca3af", textAlign: "center", marginBottom: "0.2rem", maxWidth: "60px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {transitionMap[stage.id]?.condition ?? ""}
                </div>
                <div style={{ fontSize: "1.25rem", color: "#d1d5db" }}>→</div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {selectedStage && (() => {
        const stage = chain.stages.find(s => s.id === selectedStage);
        if (!stage) return null;
        const trans = transitionMap[stage.id];
        return (
          <div style={{ border: `1px solid ${STAGE_TYPE_COLORS[stage.type]}`, borderRadius: "0.5rem", padding: "0.875rem", background: "#f9fafb" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{stage.name}</span>
                <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: STAGE_TYPE_COLORS[stage.type], color: "white" }}>
                  {STAGE_TYPE_LABELS[stage.type]}
                </span>
              </div>
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>max {stage.maxTokens.toLocaleString()} tokens</span>
            </div>
            <p style={{ fontSize: "0.8125rem", color: "#374151", margin: "0 0 0.5rem" }}>{stage.description}</p>
            {stage.dependencies.length > 0 && (
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                Depende de: {stage.dependencies.map(dep => {
                  const s = chain.stages.find(x => x.id === dep);
                  return s?.name ?? dep;
                }).join(", ")}
              </div>
            )}
            {trans && (
              <div style={{ marginTop: "0.5rem", padding: "0.375rem 0.625rem", background: "#fffbeb", borderRadius: "0.375rem", fontSize: "0.75rem", color: "#92400e" }}>
                Transição para próximo stage: <em>{trans.condition}</em>
              </div>
            )}
          </div>
        );
      })()}

      {!selectedStage && (
        <p style={{ fontSize: "0.8125rem", color: "#9ca3af", textAlign: "center", padding: "0.75rem" }}>
          Clique em um stage para ver detalhes.
        </p>
      )}
    </div>
  );
}
