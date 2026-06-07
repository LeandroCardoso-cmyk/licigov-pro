import React from "react";

interface RankBreakdown {
  legal: number;
  recency: number;
  confidence: number;
  priority: number;
  relevance: number;
}

interface RankedFragment {
  rank: number;
  source: string;
  priority: "critical" | "high" | "medium" | "low";
  rankScore: number;
  breakdown: RankBreakdown;
}

interface ContextRankingPanelProps {
  organizationId: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#6b7280",
};

const BREAKDOWN_CONFIG: { key: keyof RankBreakdown; label: string; color: string }[] = [
  { key: "legal",      label: "Legal",      color: "#3b82f6" },
  { key: "recency",    label: "Recência",   color: "#10b981" },
  { key: "confidence", label: "Confiança",  color: "#8b5cf6" },
  { key: "priority",   label: "Prioridade", color: "#f97316" },
  { key: "relevance",  label: "Relevância", color: "#ef4444" },
];

const MOCK_FRAGMENTS: RankedFragment[] = [
  { rank: 1, source: "Lei 14.133/2021 Art. 75", priority: "critical", rankScore: 0.97, breakdown: { legal: 0.99, recency: 0.95, confidence: 0.98, priority: 1.0, relevance: 0.93 } },
  { rank: 2, source: "Decreto 10.947/2022",     priority: "high",     rankScore: 0.84, breakdown: { legal: 0.91, recency: 0.88, confidence: 0.80, priority: 0.85, relevance: 0.76 } },
  { rank: 3, source: "TCU Acórdão 1234/2023",   priority: "high",     rankScore: 0.76, breakdown: { legal: 0.72, recency: 0.70, confidence: 0.85, priority: 0.75, relevance: 0.79 } },
  { rank: 4, source: "Template Edital Padrão",  priority: "medium",   rankScore: 0.61, breakdown: { legal: 0.40, recency: 0.65, confidence: 0.70, priority: 0.60, relevance: 0.68 } },
  { rank: 5, source: "Histórico de Sessão",     priority: "low",      rankScore: 0.43, breakdown: { legal: 0.20, recency: 0.72, confidence: 0.45, priority: 0.30, relevance: 0.48 } },
];

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <div style={{ flex: 1, height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden", minWidth: "60px" }}>
        <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, background: color, borderRadius: "3px" }} />
      </div>
      <span style={{ fontSize: "0.7rem", color: "#6b7280", minWidth: "2rem", textAlign: "right" }}>{Math.round(value * 100)}</span>
    </div>
  );
}

export default function ContextRankingPanel({ organizationId: _organizationId }: ContextRankingPanelProps) {
  const fragments = MOCK_FRAGMENTS;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>Ranking de Fragmentos Contextuais</h2>
      <p style={{ fontSize: "0.8125rem", color: "#6b7280", marginBottom: "1rem", marginTop: 0 }}>
        Ordenação por score composto de 5 dimensões
      </p>

      <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {BREAKDOWN_CONFIG.map(({ label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: color, flexShrink: 0 }} />
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600, color: "#374151", width: "2.5rem" }}>#</th>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600, color: "#374151" }}>Fonte</th>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "center", fontWeight: 600, color: "#374151", width: "5rem" }}>Score</th>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600, color: "#374151" }}>Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {fragments.map((frag, idx) => (
              <tr key={frag.rank} style={{ borderBottom: idx < fragments.length - 1 ? "1px solid #f3f4f6" : "none", background: idx % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "0.625rem 0.75rem", textAlign: "center" }}>
                  <span style={{ fontWeight: 700, color: frag.rank === 1 ? "#f59e0b" : "#9ca3af", fontSize: frag.rank === 1 ? "1rem" : "0.875rem" }}>
                    {frag.rank === 1 ? "★" : frag.rank}
                  </span>
                </td>
                <td style={{ padding: "0.625rem 0.75rem" }}>
                  <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>{frag.source}</div>
                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: PRIORITY_COLORS[frag.priority], color: "white" }}>
                    {frag.priority}
                  </span>
                </td>
                <td style={{ padding: "0.625rem 0.75rem", textAlign: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: frag.rankScore >= 0.8 ? "#10b981" : frag.rankScore >= 0.6 ? "#f59e0b" : "#ef4444" }}>
                    {Math.round(frag.rankScore * 100)}
                  </div>
                </td>
                <td style={{ padding: "0.625rem 0.75rem" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {BREAKDOWN_CONFIG.map(({ key, label, color }) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        <span style={{ fontSize: "0.7rem", color: "#9ca3af", minWidth: "4rem" }}>{label}</span>
                        <ScoreBar value={frag.breakdown[key]} color={color} />
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
