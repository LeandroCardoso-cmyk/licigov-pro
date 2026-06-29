import React from "react";
interface Stats { total: number; totalTokens: number; providers: Record<string, number>; versions: Record<string, number>; }
interface Props { stats: Stats; organizationId: number; }
export function EmbeddingAnalyticsPanel({ stats, organizationId }: Props) {
  return (<div data-testid="embedding-analytics"><h3>Embedding Analytics — Org {organizationId}</h3><div>Total: {stats.total} | Tokens: {stats.totalTokens}</div><div data-testid="providers">{Object.entries(stats.providers).map(([k, v]) => <span key={k}>{k}: {v}</span>)}</div><div data-testid="versions">{Object.entries(stats.versions).map(([k, v]) => <span key={k}>{k}: {v}</span>)}</div></div>);
}
