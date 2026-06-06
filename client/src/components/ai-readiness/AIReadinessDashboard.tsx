import React, { useState } from "react";

interface AIFeatureFlag {
  name: string;
  label: string;
  enabled: boolean;
  description: string;
  category: "safety" | "execution" | "governance" | "observability";
}

interface AIProviderStatus {
  provider: string;
  available: boolean;
  mockMode: boolean;
  modelsAvailable: number;
}

interface AIReadinessMetrics {
  orchestrationsTotal: number;
  orchestrationsCompleted: number;
  orchestrationsFailed: number;
  avgExecutionMs: number;
  promptVersionsApproved: number;
  memoryEntriesActive: number;
  auditRecordsTotal: number;
  tokensBudgetUsed: number;
  tokensBudgetTotal: number;
  groundingConfidenceAvg: number;
}

interface AIReadinessDashboardProps {
  flags?: AIFeatureFlag[];
  providers?: AIProviderStatus[];
  metrics?: AIReadinessMetrics;
  organizationId?: number;
  onToggleFlag?: (flagName: string, enabled: boolean) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  safety:        "#ef4444",
  execution:     "#3b82f6",
  governance:    "#8b5cf6",
  observability: "#10b981",
};

const DEFAULT_FLAGS: AIFeatureFlag[] = [
  { name: "FF_AI_DRY_RUN",           label: "Modo dry-run",            enabled: false, description: "Todas as chamadas IA são simuladas, sem execução real",    category: "safety" },
  { name: "FF_AI_SANDBOX",           label: "Sandbox de IA",           enabled: false, description: "Ambiente de sandbox isolado para testes de IA",             category: "safety" },
  { name: "FF_AI_TENANT_ACCESS",     label: "Acesso tenant a IA",      enabled: false, description: "Permite que o tenant use funcionalidades de IA",            category: "execution" },
  { name: "FF_AI_GROUNDING",         label: "Fundamentação (grounding)", enabled: false, description: "Habilita motor de fundamentação com evidências",        category: "governance" },
  { name: "FF_AI_SEMANTIC_MEMORY",   label: "Memória semântica",       enabled: false, description: "Habilita persistência de memória semântica",                category: "execution" },
  { name: "FF_AI_VECTOR_SEARCH",     label: "Busca vetorial",          enabled: false, description: "Habilita busca por similaridade vetorial",                  category: "execution" },
  { name: "FF_AI_AUDIT_TRAIL",       label: "Trilha de auditoria",     enabled: false, description: "Registra todas as operações de IA para auditoria forense", category: "observability" },
  { name: "FF_AI_HUMAN_REVIEW",      label: "Revisão humana",          enabled: false, description: "Força revisão humana antes de completar workflow de IA",    category: "governance" },
  { name: "FF_AI_COST_TRACKING",     label: "Rastreamento de custos",  enabled: false, description: "Habilita estimativa e rastreamento de custos de token",    category: "observability" },
  { name: "FF_AI_PROMPT_GOVERNANCE", label: "Governança de prompts",   enabled: false, description: "Exige aprovação para versões de prompt antes do uso",      category: "governance" },
];

export function AIReadinessDashboard({ flags = DEFAULT_FLAGS, providers = [], metrics, organizationId, onToggleFlag }: AIReadinessDashboardProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const enabledCount = flags.filter(f => f.enabled).length;
  const readinessScore = Math.round((enabledCount / Math.max(flags.length, 1)) * 100);

  const filteredFlags = activeCategory === "all" ? flags : flags.filter(f => f.category === activeCategory);
  const categoryCounts = flags.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, {});

  const scoreColor = readinessScore >= 70 ? "#10b981" : readinessScore >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.25rem" }}>
            Painel de Prontidão IA
          </h1>
          {organizationId && (
            <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
          )}
        </div>
        <div style={{ textAlign: "center", background: "#f9fafb", borderRadius: "0.75rem", padding: "0.75rem 1.25rem" }}>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: scoreColor }}>{readinessScore}%</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Prontidão</div>
        </div>
      </div>

      {readinessScore < 100 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem", fontSize: "0.8125rem" }}>
          ⚠️ <strong>Modo seguro ativo:</strong> {flags.length - enabledCount} {flags.length - enabledCount === 1 ? "flag desabilitada" : "flags desabilitadas"}. Todos os recursos de IA estão desligados por padrão para garantir segurança.
        </div>
      )}

      {providers.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>Provedores IA</h2>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(providers.length, 4)}, 1fr)`, gap: "0.5rem" }}>
            {providers.map(p => (
              <div key={p.provider} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.5rem", textAlign: "center" }}>
                <div style={{ fontWeight: 600, fontSize: "0.8125rem" }}>{p.provider}</div>
                <div style={{ display: "flex", justifyContent: "center", gap: "0.375rem", marginTop: "0.25rem" }}>
                  <span style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px", background: p.available ? "#d1fae5" : "#fee2e2", color: p.available ? "#065f46" : "#991b1b" }}>
                    {p.available ? "Disponível" : "Indisponível"}
                  </span>
                  {p.mockMode && <span style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px", background: "#fef3c7", color: "#92400e" }}>Mock</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>{p.modelsAvailable} modelos</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {metrics && (
        <div style={{ marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>Métricas</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
            {[
              { label: "Orquestrações", value: metrics.orchestrationsTotal, sub: `${metrics.orchestrationsCompleted} concluídas` },
              { label: "Prompts aprovados", value: metrics.promptVersionsApproved, sub: "versões ativas" },
              { label: "Memórias ativas", value: metrics.memoryEntriesActive, sub: "entradas" },
              { label: "Registros de auditoria", value: metrics.auditRecordsTotal, sub: "imutáveis" },
              { label: "Confiança de fundamentação", value: `${Math.round(metrics.groundingConfidenceAvg * 100)}%`, sub: "média" },
              { label: "Latência média", value: `${metrics.avgExecutionMs}ms`, sub: "por execução" },
            ].map(m => (
              <div key={m.label} style={{ background: "#f9fafb", borderRadius: "0.375rem", padding: "0.5rem" }}>
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{m.label}</div>
                <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>{m.value}</div>
                <div style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>{m.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151" }}>Feature Flags de IA</h2>
          <div style={{ display: "flex", gap: "0.375rem" }}>
            {["all", "safety", "execution", "governance", "observability"].map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: "0.125rem 0.5rem", borderRadius: "9999px", border: "1px solid #d1d5db", cursor: "pointer", fontSize: "0.75rem",
                  background: activeCategory === cat ? (CATEGORY_COLORS[cat] ?? "#3b82f6") : "white",
                  color: activeCategory === cat ? "white" : "#374151"
                }}
              >
                {cat === "all" ? `Todos (${flags.length})` : `${cat} (${categoryCounts[cat] ?? 0})`}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {filteredFlags.map(flag => (
            <div
              key={flag.name}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.5rem 0.75rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem",
                background: flag.enabled ? "#f0fdf4" : "white",
                borderLeft: `4px solid ${flag.enabled ? "#10b981" : "#d1d5db"}`
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{flag.label}</span>
                  <span style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px", background: CATEGORY_COLORS[flag.category] ?? "#9ca3af", color: "white" }}>
                    {flag.category}
                  </span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.125rem" }}>{flag.description}</div>
                <div style={{ fontSize: "0.625rem", color: "#d1d5db", marginTop: "0.125rem", fontFamily: "monospace" }}>{flag.name}</div>
              </div>
              {onToggleFlag ? (
                <div
                  onClick={() => onToggleFlag(flag.name, !flag.enabled)}
                  style={{
                    width: "2.5rem", height: "1.25rem", borderRadius: "9999px",
                    background: flag.enabled ? "#10b981" : "#d1d5db",
                    cursor: "pointer", position: "relative", flexShrink: 0, marginLeft: "0.75rem", transition: "background 0.2s"
                  }}
                >
                  <div style={{
                    position: "absolute", top: "0.125rem",
                    left: flag.enabled ? "1.375rem" : "0.125rem",
                    width: "1rem", height: "1rem",
                    borderRadius: "50%", background: "white", transition: "left 0.2s"
                  }} />
                </div>
              ) : (
                <span style={{ fontSize: "0.75rem", color: flag.enabled ? "#10b981" : "#9ca3af", fontWeight: 600, flexShrink: 0, marginLeft: "0.75rem" }}>
                  {flag.enabled ? "ATIVO" : "INATIVO"}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
