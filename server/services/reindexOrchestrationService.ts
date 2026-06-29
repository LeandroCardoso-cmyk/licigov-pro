import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export type ReindexStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "approved" | "rejected";
export type ReindexType = "full_reindex" | "incremental" | "version_migration" | "orphan_cleanup";

export interface ReindexJob {
  readonly id: string;
  readonly organizationId: number;
  readonly corpusId: string;
  readonly reindexType: ReindexType;
  readonly status: ReindexStatus;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly totalChunks: number;
  readonly processedChunks: number;
  readonly failedChunks: number;
  readonly requiresApproval: boolean;
  readonly approvedBy: string | null;
  readonly correlationId: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

const _jobs = new Map<number, ReindexJob[]>();

export function createReindexJob(params: {
  organizationId: number;
  corpusId: string;
  reindexType: ReindexType;
  fromVersion: string;
  toVersion: string;
  totalChunks: number;
  requiresApproval?: boolean;
  correlationId: string;
}): ReindexJob {
  const now = new Date().toISOString();
  const id = sha256(`reindex:${params.organizationId}:${params.corpusId}:${now}`).slice(0, 20);
  const job: ReindexJob = {
    id, organizationId: params.organizationId, corpusId: params.corpusId,
    reindexType: params.reindexType, status: params.requiresApproval ? "pending" : "running",
    fromVersion: params.fromVersion, toVersion: params.toVersion,
    totalChunks: params.totalChunks, processedChunks: 0, failedChunks: 0,
    requiresApproval: params.requiresApproval ?? false, approvedBy: null,
    correlationId: params.correlationId, startedAt: params.requiresApproval ? null : now,
    completedAt: null, createdAt: now,
  };
  const existing = _jobs.get(params.organizationId) ?? [];
  _jobs.set(params.organizationId, [...existing, job]);
  return job;
}

export function approveReindexJob(organizationId: number, jobId: string, approvedBy: string): ReindexJob | null {
  const existing = _jobs.get(organizationId) ?? [];
  const idx = existing.findIndex(j => j.id === jobId);
  if (idx === -1) return null;
  const job = existing[idx]!;
  if (job.status !== "pending") return null;
  const updated: ReindexJob = { ...job, status: "approved", approvedBy, startedAt: new Date().toISOString() };
  const newList = [...existing]; newList[idx] = updated;
  _jobs.set(organizationId, newList);
  return updated;
}

export function updateJobProgress(organizationId: number, jobId: string, processed: number, failed: number): ReindexJob | null {
  const existing = _jobs.get(organizationId) ?? [];
  const idx = existing.findIndex(j => j.id === jobId);
  if (idx === -1) return null;
  const job = existing[idx]!;
  const newProcessed = job.processedChunks + processed;
  const newFailed = job.failedChunks + failed;
  const isComplete = newProcessed + newFailed >= job.totalChunks;
  const updated: ReindexJob = {
    ...job, processedChunks: newProcessed, failedChunks: newFailed,
    status: isComplete ? (newFailed > 0 ? "failed" : "completed") : job.status,
    completedAt: isComplete ? new Date().toISOString() : null,
  };
  const newList = [...existing]; newList[idx] = updated;
  _jobs.set(organizationId, newList);
  return updated;
}

export function getReindexJobs(organizationId: number, corpusId?: string): ReindexJob[] {
  const all = _jobs.get(organizationId) ?? [];
  return corpusId ? all.filter(j => j.corpusId === corpusId) : all;
}

export function getReindexJob(organizationId: number, jobId: string): ReindexJob | null {
  return ((_jobs.get(organizationId) ?? []).find(j => j.id === jobId)) ?? null;
}

export function cancelReindexJob(organizationId: number, jobId: string): ReindexJob | null {
  const existing = _jobs.get(organizationId) ?? [];
  const idx = existing.findIndex(j => j.id === jobId);
  if (idx === -1) return null;
  const updated: ReindexJob = { ...existing[idx]!, status: "cancelled", completedAt: new Date().toISOString() };
  const newList = [...existing]; newList[idx] = updated;
  _jobs.set(organizationId, newList);
  return updated;
}
