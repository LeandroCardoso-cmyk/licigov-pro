import React, { useState } from "react";

interface InstitutionalMemory {
  id: string;
  memoryType: "policy" | "precedent" | "preference" | "workflow" | "knowledge";
  content: string;
  confidence: number;
  accessCount: number;
  tags: string[];
  createdAt: string;
  lastAccessedAt: string;
}

interface InstitutionalMemoryViewerProps {
  organizationId: number;
}

const MOCK_MEMORIES: InstitutionalMemory[] = [
  {
    id: "im-001",
    memoryType: "policy",
    content: "Esta organização exige análise jurídica prévia para todos os contratos acima de R$ 100.000,00, independentemente da modalidade licitatória.",
    confidence: 0.96,
    accessCount: 42,
    tags: ["contratos", "análise-jurídica", "limites", "governança"],
    createdAt: "2024-03-15T09:00:00Z",
    lastAccessedAt: "2024-12-09T14:30:00Z",
  },
  {
    id: "im-002",
    memoryType: "precedent",
    content: "Em pregões eletrônicos, a organização historicamente aceita atestados de capacidade técnica emitidos há até 5 anos, conforme decisão da PGM de 2022.",
    confidence: 0.88,
    accessCount: 27,
    tags: ["pregão", "atestado", "habilitação", "capacidade-técnica"],
    createdAt: "2024-05-20T11:00:00Z",
    lastAccessedAt: "2024-12-08T10:15:00Z",
  },
  {
    id: "im-003",
    memoryType: "workflow",
    content: "O fluxo de aprovação interno requer três assinaturas: gestor de contrato, diretor financeiro e assessoria jurídica. Prazo médio: 7 dias úteis.",
    confidence: 0.92,
    accessCount: 61,
    tags: ["aprovação", "fluxo", "assinatura", "prazo"],
    createdAt: "2024-01-10T08:00:00Z",
    lastAccessedAt: "2024-12-10T09:00:00Z",
  },
  {
    id: "im-004",
    memoryType: "knowledge",
    content: "A organização utiliza o CATMAT código 466670 para papel A4 e o CATSER código 2684 para serviços de impressão, conforme padronização interna de 2023.",
    confidence: 0.84,
    accessCount: 18,
    tags: ["catmat", "catser", "material", "padronização"],
    createdAt: "2024-02-05T10:30:00Z",
    lastAccessedAt: "2024-12-05T16:00:00Z",
  },
  {
    id: "im-005",
    memoryType: "preference",
    content: "Contratos de TI são preferencialmente estruturados com vigência de 12 meses renováveis, com medição mensal baseada em OS (ordens de serviço) entregues.",
    confidence: 0.79,
    accessCount: 33,
    tags: ["ti", "contrato", "vigência", "medição"],
    createdAt: "2024-04-18T13:00:00Z",
    lastAccessedAt: "2024-12-07T11:45:00Z",
  },
];

const TYPE_COLORS: Record<string, string> = {
  policy:     "#ef4444",
  precedent:  "#8b5cf6",
  preference: "#3b82f6",
  workflow:   "#f59e0b",
  knowledge:  "#10b981",
};

const TYPE_LABELS: Record<string, string> = {
  policy:     "Política",
  precedent:  "Precedente",
  preference: "Preferência",
  workflow:   "Fluxo",
  knowledge:  "Conhecimento",
};

export default function InstitutionalMemoryViewer({ organizationId }: InstitutionalMemoryViewerProps) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = typeFilter === "all"
    ? MOCK_MEMORIES
    : MOCK_MEMORIES.filter(m => m.memoryType === typeFilter);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Memória Institucional
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
        <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{MOCK_MEMORIES.length}</div>
          <div style={{ fontSize: "0.6875rem", color: "#6b7280" }}>memórias</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {["all", "policy", "precedent", "preference", "workflow", "knowledge"].map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            style={{
              padding: "0.25rem 0.625rem", borderRadius: "9999px", border: "1px solid #d1d5db",
              cursor: "pointer", fontSize: "0.75rem",
              background: typeFilter === t ? (TYPE_COLORS[t] ?? "#374151") : "white",
              color: typeFilter === t ? "white" : "#374151",
            }}
          >
            {t === "all" ? "Todos" : TYPE_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {filtered.map(mem => (
          <div
            key={mem.id}
            style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}
          >
            <div
              onClick={() => setExpandedId(expandedId === mem.id ? null : mem.id)}
              style={{
                padding: "0.625rem 0.75rem", cursor: "pointer", display: "flex",
                justifyContent: "space-between", alignItems: "flex-start",
                borderLeft: `4px solid ${TYPE_COLORS[mem.memoryType]}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{
                    fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px",
                    background: TYPE_COLORS[mem.memoryType], color: "white", flexShrink: 0,
                  }}>
                    {TYPE_LABELS[mem.memoryType]}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                    {mem.accessCount} acessos
                  </span>
                </div>
                <div style={{ fontSize: "0.8125rem", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {mem.content.slice(0, 100)}{mem.content.length > 100 ? "..." : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexShrink: 0, marginLeft: "0.75rem" }}>
                <div>
                  <div style={{ width: "40px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${mem.confidence * 100}%`, background: mem.confidence > 0.8 ? "#10b981" : "#f59e0b" }} />
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "#6b7280", textAlign: "right" }}>
                    {Math.round(mem.confidence * 100)}%
                  </div>
                </div>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{expandedId === mem.id ? "▲" : "▼"}</span>
              </div>
            </div>

            {expandedId === mem.id && (
              <div style={{ padding: "0.75rem", borderTop: "1px solid #f3f4f6", background: "#fafafa" }}>
                <div style={{ fontSize: "0.8125rem", color: "#374151", lineHeight: 1.6, marginBottom: "0.5rem" }}>
                  {mem.content}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.5rem" }}>
                  {mem.tags.map(tag => (
                    <span
                      key={tag}
                      style={{ fontSize: "0.6875rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "#e5e7eb", color: "#374151" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#9ca3af", display: "flex", gap: "1rem" }}>
                  <span>Criado: {new Date(mem.createdAt).toLocaleDateString("pt-BR")}</span>
                  <span>Último acesso: {new Date(mem.lastAccessedAt).toLocaleDateString("pt-BR")}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
