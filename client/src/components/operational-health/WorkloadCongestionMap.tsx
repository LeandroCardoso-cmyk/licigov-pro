import React from "react";

interface ReviewerWorkload {
  userId:           number;
  department:       string;
  pendingReviews:   number;
  pendingApprovals: number;
  avgLatencyMs:     number;
  oldestItemAge:    number;
  isOverloaded:     boolean;
  score:            number;
}

interface Props {
  workloads: ReviewerWorkload[];
}

export function WorkloadCongestionMap({ workloads }: Props) {
  const overloaded = workloads.filter(w => w.isOverloaded);
  const healthy    = workloads.filter(w => !w.isOverloaded);

  const deptGroups: Record<string, ReviewerWorkload[]> = {};
  for (const w of workloads) {
    if (!deptGroups[w.department]) deptGroups[w.department] = [];
    deptGroups[w.department].push(w);
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h3 style={{ marginBottom: "1rem" }}>Mapa de Carga Operacional</h3>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#fee2e2", borderRadius: 8, padding: "0.75rem", textAlign: "center", minWidth: 100 }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#dc2626" }}>{overloaded.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sobrecarregados</div>
        </div>
        <div style={{ background: "#dcfce7", borderRadius: 8, padding: "0.75rem", textAlign: "center", minWidth: 100 }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#16a34a" }}>{healthy.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Com capacidade</div>
        </div>
        <div style={{ background: "#f3f4f6", borderRadius: 8, padding: "0.75rem", textAlign: "center", minWidth: 100 }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{workloads.reduce((s, w) => s + w.pendingReviews + w.pendingApprovals, 0)}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Total Pendente</div>
        </div>
      </div>

      {Object.entries(deptGroups).map(([dept, deptWorkloads]) => {
        const deptPending  = deptWorkloads.reduce((s, w) => s + w.pendingReviews + w.pendingApprovals, 0);
        const deptOverload = deptWorkloads.some(w => w.isOverloaded);
        return (
          <div key={dept} style={{ background: deptOverload ? "#fff7ed" : "#f9fafb", border: `1px solid ${deptOverload ? "#fed7aa" : "#e5e7eb"}`, borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ fontWeight: 600 }}>{dept}</span>
              <span style={{ fontSize: "0.875rem", color: deptOverload ? "#ea580c" : "#16a34a" }}>
                {deptPending} pendentes {deptOverload ? "⚠" : "✓"}
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {deptWorkloads.map(w => (
                <div
                  key={w.userId}
                  style={{
                    background: w.isOverloaded ? "#fecaca" : "#d1fae5",
                    borderRadius: 4, padding: "0.25rem 0.5rem", fontSize: "0.75rem",
                  }}
                >
                  User {w.userId} ({w.pendingReviews + w.pendingApprovals} items)
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
