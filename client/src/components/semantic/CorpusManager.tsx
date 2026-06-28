import React from "react";
interface Corpus { id: string; corpusName: string; corpusType: string; indexingStatus: string; totalChunks: number; totalEmbeddings: number; activeEmbeddingVersion: string; }
interface Props { corpora: Corpus[]; organizationId: number; }
export function CorpusManager({ corpora, organizationId }: Props) {
  return (<div data-testid="corpus-manager"><h3>Corpus Manager — Org {organizationId}</h3><div>Total Corpora: {corpora.length}</div>{corpora.map(c => (<div key={c.id} data-testid={`corpus-${c.id}`}><span>{c.corpusName}</span><span>{c.corpusType}</span><span>{c.indexingStatus}</span><span>Chunks: {c.totalChunks}</span><span>Embeddings: {c.totalEmbeddings}</span><span>Version: {c.activeEmbeddingVersion}</span></div>))}</div>);
}
