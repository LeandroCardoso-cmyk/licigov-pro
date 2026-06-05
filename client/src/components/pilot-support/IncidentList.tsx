import React from "react";

type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentStatus   = "open" | "investigating" | "mitigated" | "resolved" | "closed";

interface Incident {
  id:          string;
  title:       string;
  severity:    IncidentSeverity;
  status:      IncidentStatus;
  category:    string;
  reportedBy:  number;
  createdAt:   string;
  resolvedAt:  string | null;
}

interface Props {
  incidents:  Incident[];
  onSelect?:  (incident: Incident) => void;
}

const SEV_COLORS: Record<IncidentSeverity, string> = {
  low:      "#16a34a", medium: "#d97706", high: "#ea580c", critical: "#dc2626",
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  open:          "Aberto",
  investigating: "Investigando",
  mitigated:     "Mitigado",
  resolved:      "Resolvido",
  closed:        "Fechado",
};

const STATUS_BG: Record<IncidentStatus, string> = {
  open:          "#fee2e2", investigating: "#fef3c7", mitigated: "#e0f2fe",
  resolved:      "#dcfce7", closed: "#f3f4f6",
};

export function IncidentList({ incidents, onSelect }: Props) {
  const open     = incidents.filter(i => i.status === "open" || i.status === "investigating");
  const resolved = incidents.filter(i => i.status === "resolved" || i.status === "closed");

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h3 style={{ marginBottom: "1rem" }}>Incidentes ({incidents.length})</h3>

      {incidents.length === 0 && <p style={{ color: "#9ca3af" }}>Nenhum incidente registrado.</p>}

      {open.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 600, color: "#dc2626", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
            EM ABERTO ({open.length})
          </div>
          {open.map(i => <IncidentCard key={i.id} incident={i} onClick={() => onSelect?.(i)} />)}
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, color: "#16a34a", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
            RESOLVIDOS ({resolved.length})
          </div>
          {resolved.map(i => <IncidentCard key={i.id} incident={i} onClick={() => onSelect?.(i)} />)}
        </div>
      )}
    </div>
  );
}

function IncidentCard({ incident, onClick }: { incident: Incident; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: STATUS_BG[incident.status], border: "1px solid #e5e7eb",
        borderRadius: 8, padding: "0.75rem", marginBottom: "0.5rem", cursor: "pointer",
        borderLeft: `4px solid ${SEV_COLORS[incident.severity]}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{incident.title}</span>
        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
          {STATUS_LABELS[incident.status]}
        </span>
      </div>
      <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>
        {incident.category} · {new Date(incident.createdAt).toLocaleDateString("pt-BR")}
        {incident.resolvedAt && ` · Resolvido: ${new Date(incident.resolvedAt).toLocaleDateString("pt-BR")}`}
      </div>
    </div>
  );
}
