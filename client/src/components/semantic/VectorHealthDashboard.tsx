import React from "react";
interface Health { totalChunks: number; totalEmbeddings: number; orphanEmbeddings: number; staleEmbeddings: number; indexHealth: string; }
interface Props { health: Health; organizationId: number; corpusId: string; }
export function VectorHealthDashboard({ health, organizationId, corpusId }: Props) {
  const healthColor = health.indexHealth === "healthy" ? "green" : health.indexHealth === "degraded" ? "yellow" : "red";
  return (<div data-testid="vector-health"><h3>Vector Health — Corpus {corpusId}</h3><div>Org: {organizationId}</div><div data-testid="health-status" style={{ color: healthColor }}>{health.indexHealth}</div><div>Chunks: {health.totalChunks}</div><div>Embeddings: {health.totalEmbeddings}</div><div>Orphans: {health.orphanEmbeddings}</div><div>Stale: {health.staleEmbeddings}</div></div>);
}
