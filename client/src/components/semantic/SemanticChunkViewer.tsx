import React from "react";
interface Chunk { id: string; documentId: string; chunkIndex: number; chunkText: string; chunkStrategy: string; tokenCount: number; language: string; }
interface Props { chunks: Chunk[]; organizationId: number; }
export function SemanticChunkViewer({ chunks, organizationId }: Props) {
  return (<div data-testid="chunk-viewer"><h3>Semantic Chunks — Org {organizationId}</h3><div>Total: {chunks.length} | Tokens: {chunks.reduce((s, c) => s + c.tokenCount, 0)}</div>{chunks.map(c => (<div key={c.id} data-testid={`chunk-${c.id}`}><span>#{c.chunkIndex}</span><span>{c.chunkStrategy}</span><span>{c.tokenCount} tokens</span><p>{c.chunkText.slice(0, 100)}...</p></div>))}</div>);
}
