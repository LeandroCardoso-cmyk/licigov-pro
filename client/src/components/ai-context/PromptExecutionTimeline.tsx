import React from "react";

type StageStatus = "completed" | "failed" | "fallback";

interface ExecutedStage {
  id: string;
  name: string;
  status: StageStatus;
  tokensUsed: number;
  durationMs: number;
  note?: string;
}

interface PromptExecutionTimelineProps {
  organizationId: number;
}

const STATUS_CONFIG: Record<StageStatus, { icon: string; color: string; label: string; bg: string }> = {
  completed: { icon: "✓", color: "#10b981", label: "Concluído",  bg: "#ecfdf5" },
  failed:    { icon: "✗", color: "#ef4444", label: "Falhou",     bg: "#fef2f2" },
  fallback:  { icon: "⚠", color: "#f59e0b", label: "Fallback",   bg: "#fffbeb" },
};

const MOCK_STAGES: ExecutedStage[] = [
  { id: "e1", name: "Inicialização do Sistema",  status: "completed", tokensUsed: 312,  durationMs: 48  },
  { id: "e2", name: "Montagem de Contexto",      status: "completed", tokensUsed: 1840, durationMs: 210 },
  { id: "e3", name: "Cadeia de Raciocínio",      status: "fallback",  tokensUsed: 920,  durationMs: 680, note: "Modelo primário com timeout — usado fallback gpt-4o-mini" },
  { id: "e4", name: "Geração de Saída",          status: "completed", tokensUsed: 478,  durationMs: 320 },
];

export default function PromptExecutionTimeline({ organizationId: _organizationId }: PromptExecutionTimelineProps) {
  const stages = MOCK_STAGES;
  const totalTokens = stages.reduce((sum, s) => sum + s.tokensUsed, 0);
  const totalDuration = stages.reduce((sum, s) => sum + s.durationMs, 0);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Timeline de Execução</h2>
          <p style={{ fontSize: "0.8125rem", color: "#6b7280", margin: "0.25rem 0 0" }}>Ordem de execução dos stages do prompt chain</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Total</div>
          <div style={{ fontWeight: 700, fontSize: "0.9375rem" }}>{totalTokens.toLocaleString()} tokens</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{totalDuration} ms</div>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: "1.1875rem", top: "1.5rem", bottom: "1.5rem", width: "2px", background: "#e5e7eb" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {stages.map((stage, idx) => {
            const cfg = STATUS_CONFIG[stage.status];
            const tokenPct = Math.round((stage.tokensUsed / totalTokens) * 100);
            return (
              <div key={stage.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", paddingBottom: idx < stages.length - 1 ? "1.25rem" : "0" }}>
                <div style={{ flexShrink: 0, width: "2.375rem", height: "2.375rem", borderRadius: "50%", background: cfg.bg, border: `2px solid ${cfg.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.9375rem", color: cfg.color, zIndex: 1, position: "relative" }}>
                  {cfg.icon}
                </div>

                <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: "white" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{stage.name}</span>
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}` }}>
                        {cfg.label}
                      </span>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{stage.durationMs} ms</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ flex: 1, height: "5px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${tokenPct}%`, background: cfg.color }} />
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280", minWidth: "4.5rem", textAlign: "right" }}>
                      {stage.tokensUsed.toLocaleString()} tokens ({tokenPct}%)
                    </span>
                  </div>

                  {stage.note && (
                    <div style={{ marginTop: "0.375rem", fontSize: "0.75rem", color: "#92400e", background: "#fffbeb", padding: "0.25rem 0.5rem", borderRadius: "0.25rem" }}>
                      {stage.note}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#f9fafb", borderRadius: "0.5rem", display: "flex", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "1rem" }}>
          {(Object.entries(STATUS_CONFIG) as [StageStatus, typeof STATUS_CONFIG[StageStatus]][]).map(([status, cfg]) => {
            const count = stages.filter(s => s.status === status).length;
            return count > 0 ? (
              <div key={status} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <span style={{ color: cfg.color, fontWeight: 700 }}>{cfg.icon}</span>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{count} {cfg.label.toLowerCase()}</span>
              </div>
            ) : null;
          })}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
          {stages.length} stages · {totalTokens.toLocaleString()} tokens · {totalDuration} ms total
        </div>
      </div>
    </div>
  );
}
