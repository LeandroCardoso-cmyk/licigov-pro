/**
 * SEM-088 — varredura REAL do banco para isolamento multi-tenant (somente leitura, agregados `COUNT`).
 *
 * `tenantIsolationAuditService` avalia só os registros que o chamador entrega (amostra) e nunca consulta o banco —
 * dava a falsa sensação de cobertura. Esta varredura consulta as tabelas tenant-scoped declaradas em
 * `TENANT_SWEEP_REGISTRY` e reporta, por tabela:
 *  - `nullOrganization`: linhas com `organizationId` NULL (legado pré-tenant → `warning` em tabelas `legacy_allowed`,
 *    `critical` nas demais);
 *  - `zeroOrganization`: linhas com `organizationId = 0`;
 *  - `danglingOrganization`: linhas cuja `organizationId` não existe em `organizations` (órfãs);
 *  - `parentMismatch`: linhas cuja organização DIVERGE da organização do processo-pai (cross-tenant real, `critical`).
 * Nenhuma escrita, nenhuma correção, nenhum backfill: apenas evidência (`coverage: "database_sweep"`). Sem banco
 * disponível ⇒ `available: false` e `healthy: false` (fail-closed — nunca "saudável" por ausência de dados).
 */
import { and, eq, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { AnyMySqlColumn, AnyMySqlTable } from "drizzle-orm/mysql-core";
import {
  activityLogs, documents, importSessions, organizationMembers, organizations, procurementProcessesTable, processes,
} from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { serviceLogger } from "./observabilityService";
import type { FindingSeverity, TenantFinding } from "./tenantIsolationAuditService";

const log = serviceLogger("tenantIsolationSweep");

type SweepDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface TenantSweepTableSpec {
  readonly name: string;
  readonly table: AnyMySqlTable;
  readonly organizationColumn: AnyMySqlColumn;
  /** `legacy_allowed`: NULL é resíduo conhecido (pré-tenant) ⇒ `warning`; `forbidden` ⇒ `critical`. */
  readonly nullPolicy: "legacy_allowed" | "forbidden";
  /** Compara com a organização do processo-pai (`processes.organizationId`) via esta coluna de FK. */
  readonly parentProcessColumn?: AnyMySqlColumn;
}

/** Tabelas tenant-scoped cobertas (declaradas — o relatório lista exatamente estas, sem sugerir mais cobertura). */
export const TENANT_SWEEP_REGISTRY: readonly TenantSweepTableSpec[] = [
  { name: "processes", table: processes, organizationColumn: processes.organizationId, nullPolicy: "legacy_allowed" },
  { name: "documents", table: documents, organizationColumn: documents.organizationId, nullPolicy: "legacy_allowed", parentProcessColumn: documents.processId },
  { name: "activity_logs", table: activityLogs, organizationColumn: activityLogs.organizationId, nullPolicy: "legacy_allowed", parentProcessColumn: activityLogs.processId },
  { name: "import_sessions", table: importSessions, organizationColumn: importSessions.organizationId, nullPolicy: "forbidden" },
  { name: "procurement_processes", table: procurementProcessesTable, organizationColumn: procurementProcessesTable.organizationId, nullPolicy: "forbidden" },
  { name: "organization_members", table: organizationMembers, organizationColumn: organizationMembers.organizationId, nullPolicy: "forbidden" },
];

export interface TenantSweepTableResult {
  table: string;
  nullOrganization: number;
  zeroOrganization: number;
  danglingOrganization: number;
  parentMismatch: number | null;
}

export interface TenantSweepReport {
  coverage: "database_sweep";
  available: boolean;
  tablesCovered: string[];
  tables: TenantSweepTableResult[];
  findings: TenantFinding[];
  /** `true` somente com banco disponível E nenhum achado `critical`. */
  healthy: boolean;
  scannedAt: string;
}

async function count(query: Promise<Array<{ n: number | string }>>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.n ?? 0);
}

async function sweepTable(db: SweepDb, spec: TenantSweepTableSpec): Promise<{ result: TenantSweepTableResult; findings: TenantFinding[] }> {
  const col = spec.organizationColumn;
  const countAll = sql<number>`COUNT(*)`;
  const orgIds = db.select({ id: organizations.id }).from(organizations);

  const nullOrganization = await count(db.select({ n: countAll }).from(spec.table).where(isNull(col)));
  const zeroOrganization = await count(db.select({ n: countAll }).from(spec.table).where(eq(col, 0)));
  const danglingOrganization = await count(
    db.select({ n: countAll }).from(spec.table).where(and(isNotNull(col), ne(col, 0), notInArray(col, orgIds))),
  );
  let parentMismatch: number | null = null;
  if (spec.parentProcessColumn) {
    parentMismatch = await count(
      db.select({ n: countAll }).from(spec.table)
        .innerJoin(processes, eq(spec.parentProcessColumn, processes.id))
        .where(and(isNotNull(col), isNotNull(processes.organizationId), ne(col, processes.organizationId))),
    );
  }

  const findings: TenantFinding[] = [];
  const add = (type: TenantFinding["type"], severity: FindingSeverity, description: string, n: number) => {
    if (n > 0) findings.push({ type, severity, description, affectedEntity: spec.name, evidence: JSON.stringify({ table: spec.name, rows: n }) });
  };
  add("orphaned", spec.nullPolicy === "forbidden" ? "critical" : "warning", `${nullOrganization} linha(s) de "${spec.name}" sem organizationId (NULL).`, nullOrganization);
  add("orphaned", "critical", `${zeroOrganization} linha(s) de "${spec.name}" com organizationId = 0.`, zeroOrganization);
  add("orphaned", "critical", `${danglingOrganization} linha(s) de "${spec.name}" apontam para organização inexistente.`, danglingOrganization);
  add("cross_tenant", "critical", `${parentMismatch ?? 0} linha(s) de "${spec.name}" com organização DIFERENTE da do processo-pai.`, parentMismatch ?? 0);

  return { result: { table: spec.name, nullOrganization, zeroOrganization, danglingOrganization, parentMismatch }, findings };
}

/** Varre o banco (somente leitura). `registry`/`db` injetáveis para teste. */
export async function sweepTenantScopedTables(
  opts: { registry?: readonly TenantSweepTableSpec[]; db?: SweepDb | null } = {},
): Promise<TenantSweepReport> {
  const registry = opts.registry ?? TENANT_SWEEP_REGISTRY;
  const db = opts.db === undefined ? await getDb() : opts.db;
  const scannedAt = new Date().toISOString();
  if (!db) {
    log.warn("tenant_sweep_unavailable", {});
    return { coverage: "database_sweep", available: false, tablesCovered: [], tables: [], findings: [], healthy: false, scannedAt };
  }
  const tables: TenantSweepTableResult[] = [];
  const findings: TenantFinding[] = [];
  for (const spec of registry) {
    const swept = await sweepTable(db, spec);
    tables.push(swept.result);
    findings.push(...swept.findings);
  }
  const report: TenantSweepReport = {
    coverage: "database_sweep",
    available: true,
    tablesCovered: registry.map((r) => r.name),
    tables,
    findings,
    healthy: findings.every((f) => f.severity !== "critical"),
    scannedAt,
  };
  log.info("tenant_sweep_completed", { tables: report.tablesCovered.length, findings: findings.length, healthy: report.healthy });
  return report;
}
