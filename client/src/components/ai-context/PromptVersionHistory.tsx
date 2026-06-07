import React, { useState } from "react";

type VersionStatus = "approved" | "pending" | "deprecated";

interface TemplateVersion {
  id: string;
  version: string;
  createdAt: string;
  author: string;
  status: VersionStatus;
  description: string;
  contentBefore: string;
  contentAfter: string;
}

interface PromptVersionHistoryProps {
  organizationId: number;
}

const STATUS_CONFIG: Record<VersionStatus, { label: string; color: string; bg: string }> = {
  approved:   { label: "Aprovado",    color: "#10b981", bg: "#ecfdf5" },
  pending:    { label: "Pendente",    color: "#f59e0b", bg: "#fffbeb" },
  deprecated: { label: "Depreciado",  color: "#9ca3af", bg: "#f3f4f6" },
};

const MOCK_VERSIONS: TemplateVersion[] = [
  {
    id: "v3",
    version: "2.0.0",
    createdAt: "2025-06-01T14:32:00Z",
    author: "Maria Oliveira",
    status: "pending",
    description: "Adição de chain-of-thought para análise de risco e reestruturação da seção de citações legais.",
    contentBefore: "Analise o processo licitatório e identifique riscos. Cite as normas aplicáveis.\n\nContexto: {context}\n\nResposta:",
    contentAfter: "Analise o processo licitatório passo a passo:\n1. Identifique o enquadramento legal\n2. Liste os riscos de conformidade\n3. Cite normas aplicáveis com base legal\n\nContexto: {context}\n\nRaciocínio:",
  },
  {
    id: "v2",
    version: "1.1.0",
    createdAt: "2025-05-15T10:11:00Z",
    author: "Carlos Mendes",
    status: "approved",
    description: "Inclusão de instrução para citar acórdãos do TCU e melhoria do formato de saída.",
    contentBefore: "Analise o processo licitatório e identifique riscos. Responda em português.\n\nContexto: {context}",
    contentAfter: "Analise o processo licitatório e identifique riscos. Cite as normas aplicáveis.\n\nContexto: {context}\n\nResposta:",
  },
  {
    id: "v1",
    version: "1.0.0",
    createdAt: "2025-04-20T08:00:00Z",
    author: "Ana Silva",
    status: "deprecated",
    description: "Versão inicial do template de análise de licitações.",
    contentBefore: "",
    contentAfter: "Analise o processo licitatório e identifique riscos. Responda em português.\n\nContexto: {context}",
  },
];

const LINEAGE = ["1.0.0", "1.1.0", "2.0.0"];

function DiffView({ before, after }: { before: string; after: string }) {
  if (!before) {
    return (
      <div style={{ fontSize: "0.8125rem", color: "#374151", background: "#f0fdf4", padding: "0.5rem 0.75rem", borderRadius: "0.375rem", borderLeft: "3px solid #10b981", whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
        + {after}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
      <div>
        <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginBottom: "0.25rem" }}>Antes</div>
        <div style={{ fontSize: "0.75rem", background: "#fef2f2", padding: "0.5rem", borderRadius: "0.375rem", borderLeft: "3px solid #fca5a5", whiteSpace: "pre-wrap", fontFamily: "monospace", color: "#374151" }}>
          {before}
        </div>
      </div>
      <div>
        <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginBottom: "0.25rem" }}>Depois</div>
        <div style={{ fontSize: "0.75rem", background: "#f0fdf4", padding: "0.5rem", borderRadius: "0.375rem", borderLeft: "3px solid #a7f3d0", whiteSpace: "pre-wrap", fontFamily: "monospace", color: "#374151" }}>
          {after}
        </div>
      </div>
    </div>
  );
}

export default function PromptVersionHistory({ organizationId: _organizationId }: PromptVersionHistoryProps) {
  const [selectedVersion, setSelectedVersion] = useState<string>(MOCK_VERSIONS[0].id);
  const selected = MOCK_VERSIONS.find(v => v.id === selectedVersion) ?? MOCK_VERSIONS[0];

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>Histórico de Versões de Template</h2>
      <p style={{ fontSize: "0.8125rem", color: "#6b7280", marginBottom: "1rem", marginTop: 0 }}>
        Template: Análise de Licitação — Prompt Principal
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "0", marginBottom: "1.25rem", overflowX: "auto", paddingBottom: "0.25rem" }}>
        {LINEAGE.map((v, idx) => (
          <React.Fragment key={v}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.25rem 0.625rem", background: "#f3f4f6", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 600, color: "#374151", flexShrink: 0 }}>
              v{v}
            </div>
            {idx < LINEAGE.length - 1 && (
              <span style={{ color: "#d1d5db", fontSize: "1rem", padding: "0 0.25rem", flexShrink: 0 }}>→</span>
            )}
          </React.Fragment>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginBottom: "1rem" }}>
        {MOCK_VERSIONS.map(v => {
          const cfg = STATUS_CONFIG[v.status];
          const isSelected = v.id === selectedVersion;
          return (
            <div
              key={v.id}
              onClick={() => setSelectedVersion(v.id)}
              style={{
                border: `1px solid ${isSelected ? "#3b82f6" : "#e5e7eb"}`,
                borderRadius: "0.5rem",
                padding: "0.625rem 0.75rem",
                cursor: "pointer",
                background: isSelected ? "#eff6ff" : "white",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.875rem", color: isSelected ? "#1d4ed8" : "#111827" }}>v{v.version}</span>
                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: cfg.bg, color: cfg.color, fontWeight: 600 }}>
                    {cfg.label}
                  </span>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.75rem", color: "#9ca3af" }}>
                  <div>{v.author}</div>
                  <div>{new Date(v.createdAt).toLocaleDateString("pt-BR")}</div>
                </div>
              </div>
              <p style={{ fontSize: "0.8125rem", color: "#6b7280", margin: 0 }}>{v.description}</p>
            </div>
          );
        })}
      </div>

      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
          Diff — v{selected.version}
        </h3>
        <DiffView before={selected.contentBefore} after={selected.contentAfter} />
      </div>
    </div>
  );
}
