import { createHash } from "crypto";
import { type ProviderExecution } from "../domain/providerExecution";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export interface ReplayRecord {
  readonly snapshotKey: string;
  readonly organizationId: number;
  readonly originalExecutionId: string;
  readonly requestPayload: Record<string, unknown>;
  readonly responsePayload: Record<string, unknown>;
  readonly createdAt: string;
}

const _snapshots = new Map<string, ReplayRecord>();
const _replayHistory = new Map<number, ReplayRecord[]>();

export function createSnapshot(exec: ProviderExecution): ReplayRecord {
  const snapshotKey = sha256(`snapshot:${exec.id}:${exec.promptHash}`);
  const record: ReplayRecord = { snapshotKey, organizationId: exec.organizationId, originalExecutionId: exec.id, requestPayload: exec.requestPayload, responsePayload: exec.responsePayload, createdAt: new Date().toISOString() };
  _snapshots.set(snapshotKey, record);
  return record;
}

export function replayFromSnapshot(snapshotKey: string, organizationId: number): ReplayRecord | null {
  const snap = _snapshots.get(snapshotKey);
  if (!snap || snap.organizationId !== organizationId) return null;
  const replayRecord: ReplayRecord = { ...snap, createdAt: new Date().toISOString() };
  const existing = _replayHistory.get(organizationId) ?? [];
  _replayHistory.set(organizationId, [...existing, replayRecord]);
  return replayRecord;
}

export function validateReplay(original: ReplayRecord, replay: ReplayRecord): { valid: boolean; snapshotKeyMatch: boolean; payloadMatch: boolean } {
  const snapshotKeyMatch = original.snapshotKey === replay.snapshotKey;
  const payloadMatch = JSON.stringify(original.responsePayload) === JSON.stringify(replay.responsePayload);
  return { valid: snapshotKeyMatch && payloadMatch, snapshotKeyMatch, payloadMatch };
}

export function getReplayHistory(organizationId: number): ReplayRecord[] {
  return _replayHistory.get(organizationId) ?? [];
}
