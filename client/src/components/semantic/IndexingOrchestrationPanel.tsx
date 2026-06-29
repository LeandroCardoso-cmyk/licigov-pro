import React from "react";
interface ReindexJob { id: string; corpusId: string; reindexType: string; status: string; totalChunks: number; processedChunks: number; failedChunks: number; }
interface Props { jobs: ReindexJob[]; organizationId: number; }
export function IndexingOrchestrationPanel({ jobs, organizationId }: Props) {
  const active = jobs.filter(j => j.status === "running" || j.status === "approved");
  return (<div data-testid="indexing-panel"><h3>Indexing Orchestration — Org {organizationId}</h3><div>Total Jobs: {jobs.length} | Active: {active.length}</div>{jobs.map(j => (<div key={j.id} data-testid={`job-${j.id}`}><span>{j.reindexType}</span><span>{j.status}</span><span>{j.processedChunks}/{j.totalChunks}</span><span>Failed: {j.failedChunks}</span></div>))}</div>);
}
