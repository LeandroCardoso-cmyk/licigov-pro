import React from "react";

interface Checkpoint {
  id:             string;
  checkpointType: string;
  isValid:        boolean;
  createdAt:      string;
  integrityHash:  string;
}

interface Props {
  checkpoints: Checkpoint[];
}

const TYPE_LABELS: Record<string, string> = {
  pre_deployment:  "Pré-deployment",
  post_migration:  "Pós-migração",
  manual:          "Manual",
  scheduled:       "Agendado",
  pre_rollback:    "Pré-rollback",
};

export function RecoveryCheckpointPanel({ checkpoints }: Props) {
  if (checkpoints.length === 0) {
    return <div style={{ fontFamily: "sans-serif", color: "#6b7280", padding: "1rem" }}>Nenhum checkpoint disponível.</div>;
  }

  return (
    <div style={{ fontFamily: "sans-serif", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {checkpoints.map(cp => (
        <div
          key={cp.id}
          style={{
            background: cp.isValid ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${cp.isValid ? "#86efac" : "#fca5a5"}`,
            borderRadius: 8,
            padding: "0.75rem 1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{TYPE_LABELS[cp.checkpointType] ?? cp.checkpointType}</div>
            <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.15rem" }}>
              Hash: {cp.integrityHash.slice(0, 12)}…
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: cp.isValid ? "#16a34a" : "#dc2626" }}>
              {cp.isValid ? "Válido" : "Inválido"}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
              {new Date(cp.createdAt).toLocaleString("pt-BR")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
