import React, { useState } from "react";

type OrchestrationStatus = "completed" | "running" | "failed" | "partial";
type StageStatus = "completed" | "failed" | "skipped";

interface OrchestrationStage {
  name: string;
  status: StageStatus;
  tokensUsed: number;
  durationMs: number;
}

interface OrchestrationExecution {
  id: string;
  sessionId: string;
  chainId: string;
  status: OrchestrationStatus;
  totalTokensUsed: number;
  totalDurationMs: number;
  replayKey: string;
  correlationId: string;
  startedAt: string;
  stages: OrchestrationStage[];
}

interface OrchestrationMonitorProps {
  organizationId: number;
}

const ORCH_STATUS_CONFIG: Record<OrchestrationStatus, { label: string; color: string; bg: string }> = {
  completed: { label: "Concluído", color: "#10b981", bg: "#ecfdf5" },
  running:   { label: "Executando", color: "#3b82f6", bg: "#eff6ff" },
  failed:    { label: "Falhou",    color: "#ef4444", bg: "#fef2f2" },
  partial:   { label: "Parcial",   color: "#f59e0b", bg: "#fffbeb" },
};

const STAGE_STATUS_CONFIG: Record<StageStatus, { icon: string; color: string }> = {
  completed: { icon: "✓", color: "#10b981" },
  failed:    { icon: "✗", color: "#ef4444" },
  skipped:   { icon: "–", color: "#9ca3af" },
};

const MOCK_EXECUTIONS: OrchestrationExecution[] = [
  {
    id: "orch-001",
    sessionId: "sess-8f3a2b1c-9d4e",
    chainId: "chain-licitacao-analise",
    status: "completed",
    totalTokensUsed: 3550,
    totalDurationMs: 1258,
    replayKey: "rpk_4f8a2c1b9d3e7f0a5b2c",
    correlationId: "corr-20250607-001",
    startedAt: "2025-06-07T09:15:22Z",
    stages: [
      { name: "Inicialização do Sistema",  status: "completed", tokensUsed: 312,  durationMs: 48  },
      { name: "Montagem de Contexto",      status: "completed", tokensUsed: 1840, durationMs: 210 },
      { name: "Cadeia de Raciocínio",      status: "completed", tokensUsed: 920,  durationMs: 680 },
      { name: "Geração de Saída",          status: "completed", tokensUsed: 478,  durationMs: 320 },
    ],
  },
  {
    id: "orch-002",
    sessionId: "sess-1a2b3c4d-5e6f",
    chainId: "chain-licitacao-analise",
    status: "partial",
    totalTokensUsed: 2152,
    totalDurationMs: 892,
    replayKey: "rpk_9b1c3e5a7f2d4b6c8e0f",
    correlationId: "corr-20250607-002",
    startedAt: "2025-06-07T10:42:08Z",
    stages: [
      { name: "Inicialização do Sistema",  status: "completed", tokensUsed: 312,  durationMs: 45  },
      { name: "Montagem de Contexto",      status: "completed", tokensUsed: 1840, durationMs: 215 },
      { name: "Cadeia de Raciocínio",      status: "failed",    tokensUsed: 0,    durationMs: 632 },
      { name: "Geração de Saída",          status: "skipped",   tokensUsed: 0,    durationMs: 0   },
    ],
  },
];

export default function OrchestrationMonitor({ organizationId: _organizationId }: OrchestrationMonitorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const executions = MOCK_EXECUTIONS;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Monitor de Orquestrações</h2>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{executions.length} execuções</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {executions.map(exec => {
          const cfg = ORCH_STATUS_CONFIG[exec.status];
          const isExpanded = expandedId === exec.id;

          return (
            <div key={exec.id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
              <div
                onClick={() => setExpandedId(isExpanded ? null : exec.id)}
                style={{ padding: "0.75rem", cursor: "pointer", background: isExpanded ? "#f9fafb" : "white", borderLeft: `4px solid ${cfg.color}` }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{exec.chainId}</span>
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: cfg.bg, color: cfg.color, fontWeight: 600 }}>
                        {cfg.label}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                      Sessão: <code style={{ fontFamily: "monospace", background: "#f3f4f6", padding: "0.05rem 0.25rem", borderRadius: "3px" }}>{exec.sessionId}</code>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{exec.totalTokensUsed.toLocaleString()} tk</div>
                    <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{exec.totalDurationMs} ms</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    <span style={{ color: "#9ca3af" }}>replayKey:</span>{" "}
                    <code style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{exec.replayKey.slice(0, 8)}</code>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    <span style={{ color: "#9ca3af" }}>correlationId:</span>{" "}
                    <code style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{exec.correlationId}</code>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                    {new Date(exec.startedAt).toLocaleString("pt-BR")}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div style={{ borderTop: "1px solid #f3f4f6", padding: "0.625rem 0.75rem", background: "#fafafa" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", marginBottom: "0.375rem" }}>Stages</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {exec.stages.map((stage, idx) => {
                      const stageCfg = STAGE_STATUS_CONFIG[stage.status];
                      return (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.375rem 0.5rem", background: "white", border: "1px solid #f3f4f6", borderRadius: "0.375rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontWeight: 700, color: stageCfg.color, fontSize: "0.875rem", width: "1rem", textAlign: "center" }}>{stageCfg.icon}</span>
                            <span style={{ fontSize: "0.8125rem", color: stage.status === "skipped" ? "#9ca3af" : "#374151" }}>{stage.name}</span>
                          </div>
                          <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                            {stage.tokensUsed > 0 && <span>{stage.tokensUsed.toLocaleString()} tk</span>}
                            {stage.durationMs > 0 && <span>{stage.durationMs} ms</span>}
                            {stage.status === "skipped" && <span style={{ color: "#9ca3af" }}>pulado</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
