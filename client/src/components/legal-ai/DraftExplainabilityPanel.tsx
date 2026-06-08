import React from "react";

interface Props {
  sessionId?: string;
}

const MOCK_REASONINGS = [
  "O modelo de edital selecionado é o Pregão Eletrônico por ser a modalidade obrigatória para bens e serviços comuns conforme art. 28 da Lei 14133/2021.",
  "A estrutura do documento segue o padrão mínimo exigido pelo Decreto 10.024/2019 para pregões eletrônicos federais.",
  "O critério de julgamento por menor preço global foi adotado tendo em vista a natureza uniforme e mensurável do objeto contratado.",
  "As cláusulas de habilitação foram calibradas com base no TCU Acórdão 2089/2021 para evitar restrição indevida à competitividade.",
];

const MOCK_LEGAL_BASIS = [
  { norm: "Lei 14133/2021", articles: "art. 28, 72, 75, 106", purpose: "Base normativa principal para modalidade e requisitos gerais." },
  { norm: "Decreto 10.024/2019", articles: "art. 3, 12, 34", purpose: "Regulamentação do Pregão Eletrônico no âmbito federal." },
  { norm: "IN SEGES 65/2021", articles: "art. 2, 5, 9", purpose: "Pesquisa de preços e estimativa de valor do objeto." },
  { norm: "TCU Acórdão 2089/2021", articles: "item 9.1", purpose: "Critérios de pesquisa de preços e fontes aceitáveis." },
];

const MOCK_RECOMMENDATIONS = [
  { priority: 1, content: "Adicionar referência explícita ao art. 72 da Lei 14133/2021 na justificativa do edital.", type: "mandatory" },
  { priority: 2, content: "Revisar os critérios de habilitação técnica para garantir compatibilidade com o objeto.", type: "advisory" },
  { priority: 3, content: "Incluir cláusula de sustentabilidade conforme IN SLTI/MPOG nº 01/2010.", type: "optional" },
];

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  mandatory: { label: "Obrigatório", color: "#ef4444", bg: "#fef2f2" },
  advisory:  { label: "Recomendado", color: "#f59e0b", bg: "#fffbeb" },
  optional:  { label: "Opcional",    color: "#10b981", bg: "#ecfdf5" },
};

export default function DraftExplainabilityPanel({ sessionId = "demo" }: Props) {
  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Explicabilidade do Rascunho</h2>
        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
      </div>

      {/* Why this draft */}
      <div style={{ marginBottom: "1.25rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.875rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#374151", marginBottom: "0.625rem", borderBottom: "1px solid #e5e7eb", paddingBottom: "0.375rem" }}>
          Por que este rascunho?
        </h3>
        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
          {MOCK_REASONINGS.map((r, i) => (
            <li key={i} style={{ fontSize: "0.8125rem", color: "#374151", lineHeight: 1.6, marginBottom: "0.375rem" }}>
              {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Legal foundations */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#374151", marginBottom: "0.625rem" }}>
          Fundamentos Legais Utilizados
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_LEGAL_BASIS.map((b, i) => (
            <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: "white", borderLeft: "3px solid #1d4ed8" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1d4ed8" }}>{b.norm}</span>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{b.articles}</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: 0 }}>{b.purpose}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Priority recommendations */}
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#374151", marginBottom: "0.625rem" }}>
          Recomendações Prioritárias (Top 3)
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_RECOMMENDATIONS.map((rec, i) => {
            const cfg = TYPE_LABELS[rec.type];
            return (
              <div key={i} style={{ border: `1px solid ${cfg.color}`, borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: cfg.bg }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: cfg.color, width: "1.5rem", height: "1.5rem", borderRadius: "50%", background: "white", border: `1px solid ${cfg.color}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {rec.priority}
                  </span>
                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: "white", color: cfg.color, fontWeight: 600, border: `1px solid ${cfg.color}` }}>
                    {cfg.label}
                  </span>
                </div>
                <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0 }}>{rec.content}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
