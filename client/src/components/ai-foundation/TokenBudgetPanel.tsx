import React from "react";

interface TokenBudget {
  id: string;
  sessionId: string;
  model: string;
  maxTokens: number;
  usedTokens: number;
  reservedTokens: number;
  availableTokens: number;
  costEstimateUsd: number;
  warnings: string[];
  hardLimit: boolean;
  updatedAt: string;
}

interface CostForecast {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  currency: string;
  breakdown: { inputCost: number; outputCost: number };
}

interface TokenBudgetPanelProps {
  budget?: TokenBudget;
  forecast?: CostForecast;
}

export function TokenBudgetPanel({ budget, forecast }: TokenBudgetPanelProps) {
  if (!budget) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "1rem", textAlign: "center", color: "#9ca3af" }}>
        Nenhum orçamento de tokens configurado.
      </div>
    );
  }

  const usedPercent = Math.round((budget.usedTokens / budget.maxTokens) * 100);
  const reservedPercent = Math.round((budget.reservedTokens / budget.maxTokens) * 100);
  const availablePercent = Math.round((budget.availableTokens / budget.maxTokens) * 100);

  const barColor = usedPercent > 90 ? "#ef4444" : usedPercent > 70 ? "#f59e0b" : "#3b82f6";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Orçamento de Tokens
      </h2>

      <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <div>
            <span style={{ fontWeight: 600 }}>{budget.model}</span>
            <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {budget.sessionId.slice(0, 12)}...</span>
          </div>
          {budget.hardLimit && (
            <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", background: "#fef2f2", color: "#ef4444", borderRadius: "9999px", border: "1px solid #fca5a5" }}>
              Limite rígido
            </span>
          )}
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <div style={{ height: "16px", background: "#e5e7eb", borderRadius: "8px", overflow: "hidden", display: "flex" }}>
            <div style={{ height: "100%", width: `${usedPercent}%`, background: barColor }} />
            <div style={{ height: "100%", width: `${reservedPercent}%`, background: "#fbbf24", opacity: 0.7 }} />
          </div>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem", fontSize: "0.75rem" }}>
            <span style={{ color: barColor }}>● Usado: {budget.usedTokens.toLocaleString()} ({usedPercent}%)</span>
            <span style={{ color: "#fbbf24" }}>● Reservado: {budget.reservedTokens.toLocaleString()} ({reservedPercent}%)</span>
            <span style={{ color: "#10b981" }}>● Disponível: {budget.availableTokens.toLocaleString()} ({availablePercent}%)</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div style={{ background: "white", borderRadius: "0.375rem", padding: "0.5rem", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Limite máximo</div>
            <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>{budget.maxTokens.toLocaleString()}</div>
          </div>
          <div style={{ background: "white", borderRadius: "0.375rem", padding: "0.5rem", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Custo estimado</div>
            <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>${budget.costEstimateUsd.toFixed(4)}</div>
          </div>
        </div>

        {budget.warnings.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            {budget.warnings.map((w, idx) => (
              <div key={idx} style={{ padding: "0.25rem 0.5rem", background: "#fffbeb", borderRadius: "0.25rem", fontSize: "0.75rem", color: "#92400e", marginBottom: "0.25rem" }}>
                ⚠️ {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {forecast && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Previsão de Custo</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Tokens entrada</div>
              <div style={{ fontWeight: 600 }}>{forecast.inputTokens.toLocaleString()}</div>
              <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>${forecast.breakdown.inputCost.toFixed(4)}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Tokens saída</div>
              <div style={{ fontWeight: 600 }}>{forecast.outputTokens.toLocaleString()}</div>
              <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>${forecast.breakdown.outputCost.toFixed(4)}</div>
            </div>
            <div style={{ textAlign: "center", background: "#f0fdf4", borderRadius: "0.375rem", padding: "0.25rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Total estimado</div>
              <div style={{ fontWeight: 700, color: "#16a34a" }}>${forecast.estimatedCostUsd.toFixed(4)}</div>
              <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{forecast.currency}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
