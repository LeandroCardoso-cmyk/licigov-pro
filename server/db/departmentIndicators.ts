/**
 * R9 / SEM-070 — Contagens AGREGADAS dos indicadores do Centro de Operações.
 *
 * Antes, `departmentOperationService` contava em memória sobre listas truncadas (`listProcesses(…, 200)`,
 * `listOperationalEvents(…, 500)`, pareceres filtrados DEPOIS do `limit`), contava EVENTOS de vencimento
 * (6 por contrato, sem janela) e enviava `pendingTasks: 0` fixo. Aqui cada indicador lê a fonte canônica
 * com SQL COUNT/GROUP BY, isolado por `organization_id` e sempre com parâmetros Drizzle (nunca interpolação).
 * Padrão getDb(): degrada para zeros sem banco.
 */

import { and, count, eq, gte, inArray, isNull, lte, max, ne, notInArray, or } from "drizzle-orm";
import { getDb } from "./connection";
import {
  contractWorkspacesTable, directProcurementWorkspacesTable, institutionalRequestsTable,
  legalOpinionWorkspacesTable, operationRecordsTable, operationalEventsTable, procurementProcessesTable, tasks,
} from "../../drizzle/schema";
import { ENDED_CONTRACT_STATUSES, type KeyCount } from "../domain/operationalDashboard";
import { TASK_TERMINAL_STATUSES } from "@shared/taskDeadline";

/** Status de solicitação institucional ainda pendente (mesmo conjunto de `listPendingForDomain`). */
const PENDING_REQUEST_STATUSES = ["PENDING", "RECEIVED", "IN_PROGRESS", "WAITING_INFORMATION"];
/** Etapas de parecer fora da fila ativa (mesmo critério de `listLegalOpinionWorkspaces({ activeOnly })`). */
const INACTIVE_LEGAL_OPINION_STAGES = ["RETURNED", "ARCHIVED"];

export interface DepartmentIndicatorCounts {
  readonly processesByStatus: KeyCount[];
  readonly directProcurementsByStatus: KeyCount[];
  readonly contractsByStatus: KeyCount[];
  readonly legalOpinionsPending: number;
  readonly institutionalRequestsPending: number;
  readonly contractsExpiringSoon: number;
  readonly pendingTasks: number;
  readonly activeRecordsByStage: KeyCount[];
}

const EMPTY: DepartmentIndicatorCounts = {
  processesByStatus: [], directProcurementsByStatus: [], contractsByStatus: [],
  legalOpinionsPending: 0, institutionalRequestsPending: 0, contractsExpiringSoon: 0, pendingTasks: 0,
  activeRecordsByStage: [],
};

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function toKeyCounts(rows: Array<{ key: string; n: number | string }>): KeyCount[] {
  return rows.map(r => ({ key: r.key, count: Number(r.n) }));
}

function firstCount(rows: Array<{ n: number | string }>): number {
  return Number(rows[0]?.n ?? 0);
}

/**
 * R9 / SEM-070 — contratos DISTINTOS vencendo na janela [from, to] (datas locais YYYY-MM-DD, inclusive).
 * A data de término vigente de cada contrato é o MAIOR evento de vencimento propriamente dito
 * (`vencimento_contrato`, `alert_offset_days = 0` — os alertas 90/60/30/15/7d nunca contam) do contrato;
 * uma prorrogação registrada (nova data) substitui a anterior. Contrato com workspace encerrado/rescindido/
 * arquivado fica fora. Agregação inteiramente no banco: COUNT sobre GROUP BY reference_id … HAVING.
 */
async function countExpiringContracts(db: Db, orgId: number, from: string, to: string): Promise<number> {
  const endDate = max(operationalEventsTable.eventDate);
  const perContract = db.select({ referenceId: operationalEventsTable.referenceId })
    .from(operationalEventsTable)
    .leftJoin(contractWorkspacesTable, and(
      eq(contractWorkspacesTable.id, operationalEventsTable.referenceId),
      eq(contractWorkspacesTable.organizationId, operationalEventsTable.organizationId),
    ))
    .where(and(
      eq(operationalEventsTable.organizationId, orgId),
      eq(operationalEventsTable.eventType, "vencimento_contrato"),
      eq(operationalEventsTable.referenceType, "contrato"),
      eq(operationalEventsTable.alertOffsetDays, 0),
      or(isNull(contractWorkspacesTable.id), notInArray(contractWorkspacesTable.status, [...ENDED_CONTRACT_STATUSES])),
    ))
    .groupBy(operationalEventsTable.referenceId)
    .having(and(gte(endDate, from), lte(endDate, to)))
    .as("expiring_contracts");
  const rows = await db.select({ n: count() }).from(perContract);
  return firstCount(rows);
}

/** Apenas "Contratos vencendo" (usado pelas recomendações). */
export async function countContractsExpiringInWindow(orgId: number, window: { from: string; to: string }): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return countExpiringContracts(db, orgId, window.from, window.to);
}

/** R9 / SEM-070 — todas as contagens dos indicadores do órgão (exatas, sem `limit`). */
export async function countDepartmentIndicators(orgId: number, window: { from: string; to: string }): Promise<DepartmentIndicatorCounts> {
  const db = await getDb();
  if (!db) return EMPTY;

  const [processes, directs, contracts, legal, requests, expiring, pendingTasks, records] = await Promise.all([
    db.select({ key: procurementProcessesTable.status, n: count() }).from(procurementProcessesTable)
      .where(eq(procurementProcessesTable.organizationId, orgId))
      .groupBy(procurementProcessesTable.status),
    db.select({ key: directProcurementWorkspacesTable.status, n: count() }).from(directProcurementWorkspacesTable)
      .where(eq(directProcurementWorkspacesTable.organizationId, orgId))
      .groupBy(directProcurementWorkspacesTable.status),
    db.select({ key: contractWorkspacesTable.status, n: count() }).from(contractWorkspacesTable)
      .where(eq(contractWorkspacesTable.organizationId, orgId))
      .groupBy(contractWorkspacesTable.status),
    db.select({ n: count() }).from(legalOpinionWorkspacesTable).where(and(
      eq(legalOpinionWorkspacesTable.organizationId, orgId),
      notInArray(legalOpinionWorkspacesTable.currentStage, INACTIVE_LEGAL_OPINION_STAGES),
    )),
    db.select({ n: count() }).from(institutionalRequestsTable).where(and(
      eq(institutionalRequestsTable.organizationId, orgId),
      eq(institutionalRequestsTable.destinationDomain, "parecer_juridico"),
      inArray(institutionalRequestsTable.status, PENDING_REQUEST_STATUSES),
    )),
    countExpiringContracts(db, orgId, window.from, window.to),
    // "Tarefas pendentes" = tarefas da Gestão do Departamento ainda abertas (nem concluídas nem canceladas).
    db.select({ n: count() }).from(tasks).where(and(
      eq(tasks.organizationId, orgId),
      notInArray(tasks.status, [...TASK_TERMINAL_STATUSES]),
    )),
    db.select({ key: operationRecordsTable.currentStage, n: count() }).from(operationRecordsTable)
      .where(and(eq(operationRecordsTable.organizationId, orgId), ne(operationRecordsTable.lifecycleStatus, "completed")))
      .groupBy(operationRecordsTable.currentStage),
  ]);

  return {
    processesByStatus: toKeyCounts(processes),
    directProcurementsByStatus: toKeyCounts(directs),
    contractsByStatus: toKeyCounts(contracts),
    legalOpinionsPending: firstCount(legal),
    institutionalRequestsPending: firstCount(requests),
    contractsExpiringSoon: expiring,
    pendingTasks: firstCount(pendingTasks),
    activeRecordsByStage: toKeyCounts(records),
  };
}
