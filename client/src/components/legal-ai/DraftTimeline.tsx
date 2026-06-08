import React from "react";

interface Props {
  sessionId?: string;
  organizationId?: number;
}

type StageStatus = "completed" | "running" | "pending";

interface TimelineStage {
  id: string;
  key: string;
  label: string;
  status: StageStatus;
  score: number | null;
  timestamp: string | null;
}

const MOCK_STAGES: TimelineStage[] = [
  { id: "s1", key: "draft_initiated",     label: "Rascunho Iniciado",       status: "completed", score: 1.0,  timestamp: "08/06/2026 09:00" },
  { id: "s2", key: "template_selected",   label: "Template Selecionado",    status: "completed", score: 0.95, timestamp: "08/06/2026 09:01" },
  { id: "s3", key: "variables_resolved",  label: "Variáveis Resolvidas",    status: "completed", score: 0.85, timestamp: "08/06/2026 09:04" },
  { id: "s4", key: "clauses_validated",   label: "Cláusulas Validadas",     status: "completed", score: 0.82, timestamp: "08/06/2026 09:07" },
  { id: "s5", key: "legal_review",        label: "Revisão Jurídica",        status: "running",   score: null, timestamp: null },
  { id: "s6", key: "compliance_check",    label: "Verificação de Conformidade", status: "pending", score: null, timestamp: null },
  { id: "s7", key: "risk_assessment",     label: "Avaliação de Riscos",     status: "pending", score: null, timestamp: null },
  { id: "s8", key: "draft_approved",      label: "Rascunho Aprovado",       status: "pending", score: null, timestamp: null },
];

const STATUS_CONFIG: Record<StageStatus, { icon: string; color: string; bg: string; border: string; label: string }> = {
  completed: { icon: "✓", color: "#10b981", bg: "#ecfdf5", border: "#6ee7b7", label: "Concluído" },
  running:   { icon: "⟳", color: "#3b82f6", bg: "#dbeafe", border: "#93c5fd", label: "Em andamento" },
  pending:   { icon: "○", color: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb", label: "Pendente" },
};

export default function DraftTimeline({ sessionId = "demo", organizationId = 1 }: Props) {
  const completedCount = MOCK_STAGES.filter(s => s.status === "completed").length;
  const progress = Math.round((completedCount / MOCK_STAGES.length) * 100);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Timeline do Rascunho</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {/* Progress */}
      <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1.25rem", border: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.375rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "#374151" }}>
            {completedCount} de {MOCK_STAGES.length} etapas concluídas
          </span>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#3b82f6" }}>{progress}%</span>
        </div>
        <div style={{ height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "#3b82f6", transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Timeline */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {MOCK_STAGES.map((stage, idx) => {
          const cfg = STATUS_CONFIG[stage.status];
          const isLast = idx === MOCK_STAGES.length - 1;
          return (
            <div key={stage.id} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              {/* Icon + connector */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: "2rem", height: "2rem", borderRadius: "50%", background: cfg.bg, border: `2px solid ${cfg.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: cfg.color, fontWeight: 700 }}>
                  {cfg.icon}
                </div>
                {!isLast && (
                  <div style={{ width: "2px", height: "1.5rem", background: idx < completedCount - 1 ? "#6ee7b7" : "#e5e7eb", marginTop: "2px" }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : "0.75rem" }}>
                <div style={{ border: `1px solid ${cfg.border}`, borderRadius: "0.5rem", padding: "0.5rem 0.75rem", background: cfg.bg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.125rem" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#111827" }}>{stage.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      {stage.score !== null && (
                        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: cfg.color }}>
                          {Math.round(stage.score * 100)}%
                        </span>
                      )}
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: "white", color: cfg.color, border: `1px solid ${cfg.border}`, fontWeight: 600 }}>
                        {cfg.label}
                      </span>
                    </div>
                  </div>
                  {stage.timestamp ? (
                    <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{stage.timestamp}</div>
                  ) : (
                    <div style={{ fontSize: "0.7rem", color: "#d1d5db" }}>Aguardando...</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
