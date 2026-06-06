import React, { useState } from "react";

interface PromptVersion {
  id: string;
  promptKey: string;
  version: string;
  content: string;
  variables: string[];
  status: "draft" | "pending_review" | "approved" | "rejected" | "deprecated" | "rollback";
  approvedBy?: number;
  legalBasis?: string;
  checksum: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

interface PromptViewerProps {
  versions?: PromptVersion[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onRollback?: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft:          "#6b7280",
  pending_review: "#f59e0b",
  approved:       "#10b981",
  rejected:       "#ef4444",
  deprecated:     "#9ca3af",
  rollback:       "#8b5cf6",
};

const STATUS_LABELS: Record<string, string> = {
  draft:          "Rascunho",
  pending_review: "Em revisão",
  approved:       "Aprovado",
  rejected:       "Rejeitado",
  deprecated:     "Depreciado",
  rollback:       "Rollback",
};

export function PromptViewer({ versions = [], onApprove, onReject, onRollback }: PromptViewerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const selectedVersion = versions.find(v => v.id === selected);

  const grouped = versions.reduce<Record<string, PromptVersion[]>>((acc, v) => {
    if (!acc[v.promptKey]) acc[v.promptKey] = [];
    acc[v.promptKey].push(v);
    return acc;
  }, {});

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Gerenciador de Prompts
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          <div style={{ padding: "0.5rem 0.75rem", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontSize: "0.875rem", fontWeight: 600 }}>
            Versões ({versions.length})
          </div>
          <div style={{ overflowY: "auto", maxHeight: "400px" }}>
            {Object.entries(grouped).map(([key, vers]) => (
              <div key={key}>
                <div style={{ padding: "0.5rem 0.75rem", background: "#f3f4f6", fontSize: "0.75rem", fontWeight: 600, color: "#374151" }}>
                  {key}
                </div>
                {vers.map(v => (
                  <div
                    key={v.id}
                    onClick={() => setSelected(v.id)}
                    style={{
                      padding: "0.5rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem",
                      background: selected === v.id ? "#eff6ff" : "white",
                      borderLeft: selected === v.id ? "3px solid #3b82f6" : "3px solid transparent",
                      borderBottom: "1px solid #f3f4f6"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 500 }}>v{v.version}</span>
                      <span style={{ padding: "0.125rem 0.375rem", borderRadius: "9999px", fontSize: "0.6875rem", background: STATUS_COLORS[v.status], color: "white" }}>
                        {STATUS_LABELS[v.status]}
                      </span>
                    </div>
                    <div style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{new Date(v.createdAt).toLocaleDateString("pt-BR")}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {!selectedVersion ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "#9ca3af" }}>
              Selecione uma versão para visualizar
            </div>
          ) : (
            <div>
              <div style={{ padding: "0.75rem", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{selectedVersion.promptKey}</span>
                    <span style={{ marginLeft: "0.5rem", color: "#6b7280", fontSize: "0.875rem" }}>v{selectedVersion.version}</span>
                  </div>
                  <span style={{ padding: "0.25rem 0.75rem", borderRadius: "9999px", fontSize: "0.8125rem", background: STATUS_COLORS[selectedVersion.status], color: "white" }}>
                    {STATUS_LABELS[selectedVersion.status]}
                  </span>
                </div>
                {selectedVersion.variables.length > 0 && (
                  <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                    {selectedVersion.variables.map(v => (
                      <span key={v} style={{ padding: "0.125rem 0.375rem", background: "#dbeafe", color: "#1d4ed8", borderRadius: "0.25rem", fontSize: "0.75rem" }}>
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
                {selectedVersion.legalBasis && (
                  <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#6b7280" }}>
                    Base legal: {selectedVersion.legalBasis}
                  </div>
                )}
              </div>
              <div style={{ padding: "0.75rem" }}>
                <pre style={{ fontSize: "0.8125rem", whiteSpace: "pre-wrap", fontFamily: "monospace", background: "#f9fafb", padding: "0.75rem", borderRadius: "0.375rem", maxHeight: "200px", overflowY: "auto", border: "1px solid #e5e7eb" }}>
                  {selectedVersion.content}
                </pre>
                <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                  Checksum: {selectedVersion.checksum.slice(0, 16)}... • Criado por #{selectedVersion.createdBy}
                </div>
              </div>
              {(onApprove || onReject || onRollback) && (
                <div style={{ padding: "0.75rem", borderTop: "1px solid #e5e7eb", display: "flex", gap: "0.5rem" }}>
                  {selectedVersion.status === "pending_review" && onApprove && (
                    <button onClick={() => onApprove(selectedVersion.id)} style={{ padding: "0.375rem 0.75rem", background: "#10b981", color: "white", border: "none", borderRadius: "0.375rem", cursor: "pointer", fontSize: "0.8125rem" }}>
                      Aprovar
                    </button>
                  )}
                  {selectedVersion.status === "pending_review" && onReject && (
                    <button onClick={() => onReject(selectedVersion.id)} style={{ padding: "0.375rem 0.75rem", background: "#ef4444", color: "white", border: "none", borderRadius: "0.375rem", cursor: "pointer", fontSize: "0.8125rem" }}>
                      Rejeitar
                    </button>
                  )}
                  {selectedVersion.status === "approved" && onRollback && (
                    <button onClick={() => onRollback(selectedVersion.id)} style={{ padding: "0.375rem 0.75rem", background: "#8b5cf6", color: "white", border: "none", borderRadius: "0.375rem", cursor: "pointer", fontSize: "0.8125rem" }}>
                      Rollback
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
