import { createHash } from "crypto";

export interface AIAuditRecord {
  id: string;
  organizationId: number;
  sessionId: string;
  operation:
    | "execute"
    | "retry"
    | "override"
    | "approval"
    | "rejection"
    | "escalation"
    | "completion"
    | "cancellation";
  actorId: number | null;
  provider: string | null;
  modelId: string | null;
  promptId: string | null;
  inputHash: string;
  outputHash: string | null;
  durationMs: number | null;
  tokenCount: number | null;
  success: boolean;
  error: string | null;
  replayKey: string;
  forensicSignature: string;
  immutable: boolean;
  recordedAt: string;
}

export interface AuditLineage {
  sessionId: string;
  records: AIAuditRecord[];
  firstRecordAt: string;
  lastRecordAt: string;
  totalOperations: number;
  organizationId: number;
}

const _auditLog = new Map<number, AIAuditRecord[]>();

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function generateId(input: string): string {
  return sha256(input).slice(0, 20);
}

function buildForensicSignature(fields: {
  id: string;
  organizationId: number;
  sessionId: string;
  operation: string;
  actorId: number | null;
  provider: string | null;
  modelId: string | null;
  promptId: string | null;
  inputHash: string;
  outputHash: string | null;
  durationMs: number | null;
  tokenCount: number | null;
  success: boolean;
  error: string | null;
  replayKey: string;
  recordedAt: string;
}): string {
  return sha256(JSON.stringify(fields));
}

export function recordOperation(params: {
  organizationId: number;
  sessionId: string;
  operation: AIAuditRecord["operation"];
  actorId?: number;
  provider?: string;
  modelId?: string;
  promptId?: string;
  inputs?: unknown;
  outputs?: unknown;
  durationMs?: number;
  tokenCount?: number;
  success: boolean;
  error?: string;
  replayKey: string;
}): AIAuditRecord {
  const {
    organizationId,
    sessionId,
    operation,
    actorId,
    provider,
    modelId,
    promptId,
    inputs,
    outputs,
    durationMs,
    tokenCount,
    success,
    error,
    replayKey,
  } = params;

  const now = new Date().toISOString();
  const inputHash = sha256(JSON.stringify(inputs ?? {}));
  const outputHash = outputs !== undefined ? sha256(JSON.stringify(outputs)) : null;

  const id = generateId(
    `${organizationId}:${sessionId}:${operation}:${replayKey}:${now}`
  );

  const coreFields = {
    id,
    organizationId,
    sessionId,
    operation,
    actorId: actorId ?? null,
    provider: provider ?? null,
    modelId: modelId ?? null,
    promptId: promptId ?? null,
    inputHash,
    outputHash,
    durationMs: durationMs ?? null,
    tokenCount: tokenCount ?? null,
    success,
    error: error ?? null,
    replayKey,
    recordedAt: now,
  };

  const forensicSignature = buildForensicSignature(coreFields);

  const record: AIAuditRecord = {
    ...coreFields,
    forensicSignature,
    immutable: true,
  };

  const existing = _auditLog.get(organizationId) ?? [];
  existing.push(record);
  _auditLog.set(organizationId, existing);

  return record;
}

export function getLineage(
  organizationId: number,
  sessionId: string
): AuditLineage | null {
  const records = (_auditLog.get(organizationId) ?? []).filter(
    (r) => r.sessionId === sessionId
  );

  if (records.length === 0) return null;

  const sorted = [...records].sort((a, b) =>
    a.recordedAt < b.recordedAt ? -1 : 1
  );

  return {
    sessionId,
    records: sorted,
    firstRecordAt: sorted[0].recordedAt,
    lastRecordAt: sorted[sorted.length - 1].recordedAt,
    totalOperations: sorted.length,
    organizationId,
  };
}

export function getAuditRecords(
  organizationId: number,
  limit?: number,
  offset?: number
): AIAuditRecord[] {
  const records = _auditLog.get(organizationId) ?? [];
  const start = offset ?? 0;
  const sliced = records.slice(start);
  return limit !== undefined ? sliced.slice(0, limit) : sliced;
}

export function verifyRecordIntegrity(record: AIAuditRecord): boolean {
  const coreFields = {
    id: record.id,
    organizationId: record.organizationId,
    sessionId: record.sessionId,
    operation: record.operation,
    actorId: record.actorId,
    provider: record.provider,
    modelId: record.modelId,
    promptId: record.promptId,
    inputHash: record.inputHash,
    outputHash: record.outputHash,
    durationMs: record.durationMs,
    tokenCount: record.tokenCount,
    success: record.success,
    error: record.error,
    replayKey: record.replayKey,
    recordedAt: record.recordedAt,
  };

  const expected = buildForensicSignature(coreFields);
  return expected === record.forensicSignature;
}

export function exportForensicReport(
  organizationId: number,
  sessionId: string
): string {
  const lineage = getLineage(organizationId, sessionId);

  if (!lineage) {
    return `# Forensic Report\n\nNo records found for session \`${sessionId}\` in organization \`${organizationId}\`.\n`;
  }

  const successCount = lineage.records.filter((r) => r.success).length;
  const errorCount = lineage.records.length - successCount;
  const integrityResults = lineage.records.map((r) => ({
    id: r.id,
    valid: verifyRecordIntegrity(r),
  }));
  const allValid = integrityResults.every((r) => r.valid);

  const lines: string[] = [
    `# Forensic Audit Report`,
    ``,
    `**Organization ID:** ${organizationId}`,
    `**Session ID:** ${sessionId}`,
    `**First Record:** ${lineage.firstRecordAt}`,
    `**Last Record:** ${lineage.lastRecordAt}`,
    `**Total Operations:** ${lineage.totalOperations}`,
    `**Integrity Status:** ${allValid ? "VALID" : "COMPROMISED"}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Success | ${successCount} |`,
    `| Errors | ${errorCount} |`,
    `| Integrity Verified | ${allValid ? "Yes" : "No"} |`,
    ``,
    `## Operation Log`,
    ``,
  ];

  for (const record of lineage.records) {
    const integrity = integrityResults.find((r) => r.id === record.id);
    lines.push(`### ${record.operation.toUpperCase()} — \`${record.id}\``);
    lines.push(``);
    lines.push(`- **Recorded At:** ${record.recordedAt}`);
    lines.push(`- **Actor:** ${record.actorId ?? "system"}`);
    lines.push(`- **Provider:** ${record.provider ?? "n/a"}`);
    lines.push(`- **Model:** ${record.modelId ?? "n/a"}`);
    lines.push(`- **Success:** ${record.success}`);
    if (record.error) lines.push(`- **Error:** ${record.error}`);
    lines.push(`- **Input Hash:** \`${record.inputHash}\``);
    lines.push(
      `- **Output Hash:** ${record.outputHash ? `\`${record.outputHash}\`` : "n/a"}`
    );
    lines.push(`- **Duration:** ${record.durationMs ?? "n/a"} ms`);
    lines.push(`- **Tokens:** ${record.tokenCount ?? "n/a"}`);
    lines.push(`- **Replay Key:** \`${record.replayKey}\``);
    lines.push(
      `- **Forensic Signature:** \`${record.forensicSignature.slice(0, 16)}...\``
    );
    lines.push(`- **Integrity:** ${integrity?.valid ? "OK" : "FAIL"}`);
    lines.push(``);
  }

  return lines.join("\n");
}

export function computeAuditMetrics(organizationId: number): {
  totalRecords: number;
  successRate: number;
  errorRate: number;
  avgDurationMs: number;
  operationBreakdown: Record<string, number>;
} {
  const records = _auditLog.get(organizationId) ?? [];

  if (records.length === 0) {
    return {
      totalRecords: 0,
      successRate: 0,
      errorRate: 0,
      avgDurationMs: 0,
      operationBreakdown: {},
    };
  }

  const successCount = records.filter((r) => r.success).length;
  const durations = records
    .filter((r) => r.durationMs !== null)
    .map((r) => r.durationMs as number);

  const avgDurationMs =
    durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

  const operationBreakdown: Record<string, number> = {};
  for (const record of records) {
    operationBreakdown[record.operation] =
      (operationBreakdown[record.operation] ?? 0) + 1;
  }

  return {
    totalRecords: records.length,
    successRate: successCount / records.length,
    errorRate: (records.length - successCount) / records.length,
    avgDurationMs,
    operationBreakdown,
  };
}
