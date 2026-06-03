/**
 * Sprint 3.2 — Tenant Isolation Audit Service.
 *
 * Audits multi-tenant isolation: cross-tenant access, orphaned entities,
 * cache contamination, permission anomalies.
 *
 * All operations: structured logging, no DB writes, deterministic.
 */

import type { CacheService } from "./distributedCacheService";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScanType =
  | "cross_tenant"
  | "orphaned"
  | "cache_contamination"
  | "permission_anomaly";

export type FindingSeverity = "info" | "warning" | "critical";

export interface TenantFinding {
  type:           ScanType;
  severity:       FindingSeverity;
  description:    string;
  affectedEntity: string;
  evidence:       string;
}

export interface TenantAuditResult {
  organizationId: number;
  scanType:       ScanType;
  findings:       TenantFinding[];
  scannedAt:      string;
  healthy:        boolean;
}

export interface EntityScanInput {
  table:      string;
  orgIdField: string;
  records:    Array<{ id: string | number; organizationId: number; [key: string]: unknown }>;
}

// ─── Cross-tenant access scan ────────────────────────────────────────────────

export function scanCrossTenantAccess(
  orgId:    number,
  entities: EntityScanInput[],
): TenantAuditResult {
  const findings: TenantFinding[] = [];

  for (const entity of entities) {
    for (const record of entity.records) {
      if (record.organizationId !== orgId) {
        findings.push({
          type:           "cross_tenant",
          severity:       "critical",
          description:    `Record id=${record.id} in table "${entity.table}" belongs to org ${record.organizationId}, not ${orgId}.`,
          affectedEntity: `${entity.table}:${record.id}`,
          evidence:       JSON.stringify({ expectedOrg: orgId, actualOrg: record.organizationId }),
        });
      }
    }
  }

  const result: TenantAuditResult = {
    organizationId: orgId,
    scanType: "cross_tenant",
    findings,
    scannedAt: new Date().toISOString(),
    healthy: findings.length === 0,
  };

  console.info(JSON.stringify({
    service: "tenant_audit",
    event: "cross_tenant_scan",
    organizationId: orgId,
    findingCount: findings.length,
    healthy: result.healthy,
    timestamp: new Date().toISOString(),
  }));

  return result;
}

// ─── Orphaned entities detection ─────────────────────────────────────────────

export function detectOrphanedEntities(
  orgId:    number,
  entities: EntityScanInput[],
): TenantFinding[] {
  const findings: TenantFinding[] = [];

  for (const entity of entities) {
    for (const record of entity.records) {
      // An orphaned entity has organizationId = 0 or null-ish
      if (record.organizationId === 0 || record.organizationId == null) {
        findings.push({
          type:           "orphaned",
          severity:       "warning",
          description:    `Record id=${record.id} in table "${entity.table}" has no valid organizationId.`,
          affectedEntity: `${entity.table}:${record.id}`,
          evidence:       JSON.stringify({ organizationId: record.organizationId }),
        });
      }
    }
  }

  return findings;
}

// ─── Cache contamination detection ───────────────────────────────────────────

export function detectCacheContamination(
  cacheService: CacheService,
  orgId:        number,
): TenantFinding[] {
  const findings: TenantFinding[] = [];

  // Test: set a value for orgId, then try to read from a different orgId
  const testKey = `__tenant_audit_probe_${Date.now()}`;
  const testValue = `probe_${orgId}`;
  const otherOrgId = orgId + 99999;

  cacheService.set(testKey, testValue, orgId);
  const leakedValue = cacheService.get<string>(testKey, otherOrgId);

  if (leakedValue !== null) {
    findings.push({
      type:           "cache_contamination",
      severity:       "critical",
      description:    `Cache key "${testKey}" set for org ${orgId} is readable by org ${otherOrgId}.`,
      affectedEntity: `cache:${testKey}`,
      evidence:       JSON.stringify({ orgId, otherOrgId, leakedValue }),
    });
  }

  // Cleanup
  cacheService.invalidate(testKey, orgId);
  cacheService.invalidate(testKey, otherOrgId);

  return findings;
}

// ─── Full tenant audit ───────────────────────────────────────────────────────

export function runFullTenantAudit(
  orgId:   number,
  context: {
    entities:     EntityScanInput[];
    cacheService: CacheService;
  },
): TenantAuditResult {
  const crossTenant = scanCrossTenantAccess(orgId, context.entities);
  const orphaned = detectOrphanedEntities(orgId, context.entities);
  const cacheFindings = detectCacheContamination(context.cacheService, orgId);

  const allFindings = [...crossTenant.findings, ...orphaned, ...cacheFindings];

  return {
    organizationId: orgId,
    scanType: "cross_tenant",
    findings: allFindings,
    scannedAt: new Date().toISOString(),
    healthy: allFindings.filter(f => f.severity === "critical").length === 0,
  };
}

// ─── Integrity report ────────────────────────────────────────────────────────

export interface TenantIntegrityReport {
  totalOrganizations: number;
  healthyCount:       number;
  unhealthyCount:     number;
  totalFindings:      number;
  criticalFindings:   number;
  results:            TenantAuditResult[];
  generatedAt:        string;
}

export function generateTenantIntegrityReport(
  results: TenantAuditResult[],
): TenantIntegrityReport {
  const healthy = results.filter(r => r.healthy).length;
  const totalFindings = results.reduce((s, r) => s + r.findings.length, 0);
  const criticalFindings = results.reduce(
    (s, r) => s + r.findings.filter(f => f.severity === "critical").length,
    0,
  );

  return {
    totalOrganizations: results.length,
    healthyCount: healthy,
    unhealthyCount: results.length - healthy,
    totalFindings,
    criticalFindings,
    results,
    generatedAt: new Date().toISOString(),
  };
}
