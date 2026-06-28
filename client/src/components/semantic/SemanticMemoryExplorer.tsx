import React from "react";
interface MemoryLink { id: string; sourceChunkId: string; targetChunkId: string; linkType: string; strength: number; context: string; }
interface Props { links: MemoryLink[]; organizationId: number; }
export function SemanticMemoryExplorer({ links, organizationId }: Props) {
  const byType = links.reduce((acc, l) => { acc[l.linkType] = (acc[l.linkType] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  return (<div data-testid="memory-explorer"><h3>Semantic Memory — Org {organizationId}</h3><div>Total Links: {links.length}</div><div data-testid="by-type">{Object.entries(byType).map(([k, v]) => <span key={k}>{k}: {v}</span>)}</div>{links.map(l => (<div key={l.id} data-testid={`link-${l.id}`}><span>{l.sourceChunkId} → {l.targetChunkId}</span><span>[{l.linkType}]</span><span>Strength: {l.strength.toFixed(2)}</span></div>))}</div>);
}
