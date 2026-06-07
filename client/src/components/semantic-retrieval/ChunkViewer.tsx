import React, { useState } from "react";

interface SemanticChunk {
  id: string;
  content: string;
  tokenCount: number;
  strategy: "fixed_size" | "sentence" | "paragraph" | "semantic";
  chunkIndex: number;
  totalChunks: number;
  sectionTitle: string;
  documentId: string;
}

interface ChunkViewerProps {
  organizationId: number;
}

const MOCK_CHUNKS: SemanticChunk[] = [
  { id: "ck-001", content: "O presente edital tem por objeto a contratação de empresa especializada na prestação de serviços de tecnologia da informação e comunicação, incluindo suporte técnico, manutenção preventiva e corretiva dos equipamentos de informática.", tokenCount: 52, strategy: "sentence", chunkIndex: 1, totalChunks: 18, sectionTitle: "Objeto da Licitação", documentId: "doc-001" },
  { id: "ck-002", content: "Para fins de habilitação jurídica, a licitante deverá apresentar: I — ato constitutivo, estatuto ou contrato social em vigor; II — inscrição no Cadastro Nacional da Pessoa Jurídica (CNPJ); III — documentos pessoais dos sócios administradores.", tokenCount: 68, strategy: "paragraph", chunkIndex: 3, totalChunks: 18, sectionTitle: "Habilitação Jurídica", documentId: "doc-001" },
  { id: "ck-003", content: "A proposta deverá conter: preço unitário e total para cada item em moeda corrente nacional, com duas casas decimais; prazo de validade não inferior a 60 (sessenta) dias; especificações técnicas detalhadas conforme Termo de Referência.", tokenCount: 61, strategy: "semantic", chunkIndex: 5, totalChunks: 18, sectionTitle: "Proposta de Preços", documentId: "doc-001" },
  { id: "ck-004", content: "O pagamento será realizado mensalmente, no prazo de até 30 (trinta) dias corridos após o atesto da nota fiscal, mediante crédito em conta bancária indicada pela contratada, observadas as retenções tributárias legalmente exigidas.", tokenCount: 55, strategy: "fixed_size", chunkIndex: 9, totalChunks: 18, sectionTitle: "Das Condições de Pagamento", documentId: "doc-001" },
  { id: "ck-005", content: "São obrigações da contratada: manter durante toda a execução do contrato, em compatibilidade com as obrigações por ele assumidas, todas as condições de habilitação e qualificação exigidas na licitação; comunicar imediatamente quaisquer irregularidades.", tokenCount: 59, strategy: "sentence", chunkIndex: 12, totalChunks: 18, sectionTitle: "Das Obrigações Contratuais", documentId: "doc-001" },
];

const STRATEGY_COLORS: Record<string, string> = {
  fixed_size: "#6b7280",
  sentence:   "#3b82f6",
  paragraph:  "#8b5cf6",
  semantic:   "#10b981",
};

const STRATEGY_LABELS: Record<string, string> = {
  fixed_size: "Tamanho fixo",
  sentence:   "Sentença",
  paragraph:  "Parágrafo",
  semantic:   "Semântico",
};

export default function ChunkViewer({ organizationId }: ChunkViewerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<string>("all");

  const filtered = strategyFilter === "all"
    ? MOCK_CHUNKS
    : MOCK_CHUNKS.filter(c => c.strategy === strategyFilter);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Visualizador de Chunks
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
        <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{MOCK_CHUNKS.length}</div>
          <div style={{ fontSize: "0.6875rem", color: "#6b7280" }}>chunks</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {["all", "fixed_size", "sentence", "paragraph", "semantic"].map(s => (
          <button
            key={s}
            onClick={() => setStrategyFilter(s)}
            style={{
              padding: "0.25rem 0.625rem", borderRadius: "9999px", border: "1px solid #d1d5db",
              cursor: "pointer", fontSize: "0.75rem",
              background: strategyFilter === s ? (STRATEGY_COLORS[s] ?? "#374151") : "white",
              color: strategyFilter === s ? "white" : "#374151",
            }}
          >
            {s === "all" ? "Todos" : STRATEGY_LABELS[s] ?? s}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {filtered.map(chunk => (
          <div
            key={chunk.id}
            style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}
          >
            <div
              onClick={() => setExpandedId(expandedId === chunk.id ? null : chunk.id)}
              style={{
                padding: "0.625rem 0.75rem", cursor: "pointer", display: "flex",
                justifyContent: "space-between", alignItems: "center",
                borderLeft: `4px solid ${STRATEGY_COLORS[chunk.strategy]}`,
                background: expandedId === chunk.id ? "#f9fafb" : "white",
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{chunk.sectionTitle}</div>
                <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                  {chunk.documentId} • chunk {chunk.chunkIndex}/{chunk.totalChunks}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexShrink: 0 }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{chunk.tokenCount} tokens</span>
                <span style={{
                  fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px",
                  background: STRATEGY_COLORS[chunk.strategy], color: "white",
                }}>
                  {STRATEGY_LABELS[chunk.strategy]}
                </span>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{expandedId === chunk.id ? "▲" : "▼"}</span>
              </div>
            </div>
            {expandedId === chunk.id && (
              <div style={{ padding: "0.75rem", borderTop: "1px solid #f3f4f6", background: "#fafafa", fontSize: "0.8125rem", color: "#374151", lineHeight: 1.6 }}>
                {chunk.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
