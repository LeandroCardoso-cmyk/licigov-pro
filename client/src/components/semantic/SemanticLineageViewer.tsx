import React from "react";
interface LineageNode { chunkId: string; documentId: string; sourceType: string; chunkIndex: number; chunkHash: string; strategy: string; }
interface Props { nodes: LineageNode[]; organizationId: number; }
export function SemanticLineageViewer({ nodes, organizationId }: Props) {
  return (<div data-testid="lineage-viewer"><h3>Semantic Lineage — Org {organizationId}</h3><div>Nodes: {nodes.length}</div>{nodes.map(n => (<div key={n.chunkId} data-testid={`lineage-${n.chunkId}`}><span>Doc: {n.documentId}</span><span>#{n.chunkIndex}</span><span>{n.sourceType}</span><span>{n.strategy}</span><span>Hash: {n.chunkHash.slice(0, 8)}...</span></div>))}</div>);
}
