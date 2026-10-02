/**
 * Pilot Reset B2/B3 — repositório do lifecycle do Processo Licitatório (migration 0313).
 *
 * - `loadLifecycleSnapshot`: estado relevante do processo + CONTAGENS por domínio (formal/oficial e trabalho), numa
 *   única consulta agregada tenant-scoped (subconsultas indexadas por (organização, processo); sem LIKE, sem JSON scan).
 *   Com `forUpdate`, a linha do processo é lida com `FOR UPDATE` (lock da geração) dentro da transação do serviço.
 * - Escritas: só INSERT no ledger (append-only) e UPDATE de lifecycle/número na linha do processo; nenhum DELETE.
 * Nenhuma operação remota aqui.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { procurementProcessesTable, procurementProcessLifecycleEventsTable } from "../../drizzle/schema";
import { isDuplicateKeyError, type ProcurementExecutor } from "./procurement";
import type { FormalDomain, LifecycleSnapshot, LifecycleState, WorkDomain } from "../domain/processLifecycle";

function firstRow<T>(res: unknown): T | undefined {
  const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res) as T[] | undefined;
  return Array.isArray(rows) ? rows[0] : undefined;
}

type SnapshotRow = {
  id: string; organization_id: number; process_number: string; status: string; current_stage: string;
  lineage_id: string | null; generation_no: number; lifecycle_state: string; lifecycle_revision: number;
  official_promotions: number; official_documents_issued: number; derived_contracts: number;
  signed_institutional_responses: number; signed_legal_opinions: number; publications: number;
  generated_documents: number; document_edits: number; price_research: number; import_sessions: number;
  import_promotions: number; procurement_items: number; procurement_lots: number; catmat_decisions: number;
  context_facts_after_create: number; timeline_after_create: number;
};

/**
 * Estado + contagens. `null` quando o processo não existe NO ÓRGÃO (anti-enumeração: o chamador responde NOT_FOUND).
 * Colação explícita do lado de `p.id` = a colação da coluna do filho (algumas tabelas usam utf8mb4_0900_ai_ci, as
 * demais utf8mb4_unicode_ci) — mantém o índice do filho utilizável. Importações canônicas = `procurementProcessId`.
 */
export async function loadLifecycleSnapshot(
  exec: ProcurementExecutor | null, organizationId: number, processId: string, opts: { forUpdate?: boolean } = {},
): Promise<LifecycleSnapshot | null> {
  const db = exec ?? await getDb();
  if (!db) return null;
  if (opts.forUpdate) {
    await db.execute(sql`SELECT id FROM procurement_processes WHERE id = ${processId} AND organization_id = ${organizationId} FOR UPDATE`);
  }
  const row = firstRow<SnapshotRow>(await db.execute(sql`
    SELECT p.id, p.organization_id, p.process_number, p.status, p.current_stage, p.lineage_id, p.generation_no,
           p.lifecycle_state, p.lifecycle_revision,
      (SELECT COUNT(*) FROM official_document_promotions x WHERE x.organization_id = p.organization_id AND x.process_id = p.id COLLATE utf8mb4_0900_ai_ci) AS official_promotions,
      (SELECT COUNT(*) FROM official_documents x WHERE x.tenant_id = p.organization_id AND x.origin = p.id COLLATE utf8mb4_unicode_ci AND x.status = 'emitido') AS official_documents_issued,
      (SELECT COUNT(*) FROM contract_workspaces x WHERE x.organization_id = p.organization_id AND x.origin_process = p.id COLLATE utf8mb4_unicode_ci) AS derived_contracts,
      (SELECT COUNT(*) FROM institutional_responses r JOIN institutional_requests q ON q.id = r.request_id AND q.organization_id = r.organization_id
         WHERE q.organization_id = p.organization_id AND q.reference_process_id = p.id COLLATE utf8mb4_unicode_ci AND r.signed = 1) AS signed_institutional_responses,
      (SELECT COUNT(*) FROM legal_opinion_drafts d JOIN legal_opinion_workspaces w ON w.id = d.workspace_id AND w.organization_id = d.organization_id
         WHERE w.organization_id = p.organization_id AND w.reference_process_id = p.id COLLATE utf8mb4_unicode_ci AND d.signed = 1) AS signed_legal_opinions,
      (SELECT COUNT(*) FROM publication_records x WHERE x.organization_id = p.organization_id AND x.reference_id = p.id COLLATE utf8mb4_unicode_ci) AS publications,
      (SELECT COUNT(*) FROM generated_documents x WHERE x.organization_id = p.organization_id AND x.process_id = p.id) AS generated_documents,
      (SELECT COUNT(*) FROM generated_document_edits x WHERE x.organization_id = p.organization_id AND x.process_id = p.id COLLATE utf8mb4_0900_ai_ci) AS document_edits,
      (SELECT COUNT(*) FROM price_research x WHERE x.organization_id = p.organization_id AND x.process_id = p.id) AS price_research,
      (SELECT COUNT(*) FROM import_sessions x WHERE x.organizationId = p.organization_id AND x.procurementProcessId = p.id COLLATE utf8mb4_unicode_ci) AS import_sessions,
      (SELECT COUNT(*) FROM import_promotions x WHERE x.organizationId = p.organization_id AND x.procurementProcessId = p.id COLLATE utf8mb4_unicode_ci) AS import_promotions,
      (SELECT COUNT(*) FROM procurement_items x WHERE x.organization_id = p.organization_id AND x.process_id = p.id COLLATE utf8mb4_0900_ai_ci) AS procurement_items,
      (SELECT COUNT(*) FROM procurement_lots x WHERE x.organization_id = p.organization_id AND x.process_id = p.id COLLATE utf8mb4_0900_ai_ci) AS procurement_lots,
      (SELECT COUNT(*) FROM catmat_decisions x WHERE x.organizationId = p.organization_id AND x.processId = p.id COLLATE utf8mb4_unicode_ci) AS catmat_decisions,
      (SELECT COUNT(*) FROM procurement_context_facts x WHERE x.organization_id = p.organization_id AND x.process_id = p.id COLLATE utf8mb4_0900_ai_ci
         AND NOT (x.source_type = 'process' AND x.source_version = 'create')) AS context_facts_after_create,
      (SELECT COUNT(*) FROM process_timeline x WHERE x.organization_id = p.organization_id AND x.process_id = p.id
         AND x.event_type <> 'workspace_created') AS timeline_after_create
    FROM procurement_processes p
    WHERE p.id = ${processId} AND p.organization_id = ${organizationId}
  `));
  if (!row) return null;
  const n = (v: unknown) => Number(v ?? 0);
  const formal: Record<FormalDomain, number> = {
    process_issued: row.status === "emitido" || row.current_stage === "ISSUED" ? 1 : 0,
    official_promotions: n(row.official_promotions), official_documents_issued: n(row.official_documents_issued),
    derived_contracts: n(row.derived_contracts), signed_institutional_responses: n(row.signed_institutional_responses),
    signed_legal_opinions: n(row.signed_legal_opinions), publications: n(row.publications),
  };
  const work: Record<WorkDomain, number> = {
    generated_documents: n(row.generated_documents), document_edits: n(row.document_edits), price_research: n(row.price_research),
    import_sessions: n(row.import_sessions), import_promotions: n(row.import_promotions), procurement_items: n(row.procurement_items),
    procurement_lots: n(row.procurement_lots), catmat_decisions: n(row.catmat_decisions),
    context_facts_after_create: n(row.context_facts_after_create), timeline_after_create: n(row.timeline_after_create),
  };
  return {
    processId: row.id, organizationId: n(row.organization_id), processNumber: row.process_number, status: row.status,
    currentStage: row.current_stage, lineageId: row.lineage_id ?? null, generationNo: n(row.generation_no),
    lifecycleState: row.lifecycle_state as LifecycleState, lifecycleRevision: n(row.lifecycle_revision), formal, work,
  };
}

export interface LifecycleEventRow {
  id: string; organizationId: number; lineageId: string; processId: string; action: string; eventType: string;
  fromState: string; toState: string; beforeJson: string | null; afterJson: string | null; reason: string;
  actorUserId: number; eligibilityDigest: string; revisionBefore: number; revisionAfter: number;
  idempotencyKey: string; requestHash: string; resultJson: string | null; correlationId: string;
}

/** Eventos já gravados para uma chave de idempotência (replay). */
export async function getLifecycleEventsByKey(exec: ProcurementExecutor, organizationId: number, idempotencyKey: string): Promise<LifecycleEventRow[]> {
  const rows = await exec.select().from(procurementProcessLifecycleEventsTable)
    .where(and(eq(procurementProcessLifecycleEventsTable.organizationId, organizationId), eq(procurementProcessLifecycleEventsTable.idempotencyKey, idempotencyKey)));
  return rows.map((r) => ({ ...r, beforeJson: r.beforeJson ?? null, afterJson: r.afterJson ?? null, resultJson: r.resultJson ?? null }));
}

/** Histórico do lifecycle de uma linhagem (ou de um processo de geração única ainda sem linhagem). */
export async function listLifecycleEvents(organizationId: number, lineageId: string): Promise<LifecycleEventRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(procurementProcessLifecycleEventsTable)
    .where(and(eq(procurementProcessLifecycleEventsTable.organizationId, organizationId), eq(procurementProcessLifecycleEventsTable.lineageId, lineageId)))
    .orderBy(procurementProcessLifecycleEventsTable.createdAt, procurementProcessLifecycleEventsTable.id);
  return rows.map((r) => ({ ...r, beforeJson: r.beforeJson ?? null, afterJson: r.afterJson ?? null, resultJson: r.resultJson ?? null }));
}

export class LifecycleWriteRaceError extends Error {
  constructor(public readonly detail: "event" | "number" | "lineage") { super(`lifecycle_write_race:${detail}`); this.name = "LifecycleWriteRaceError"; }
}

export async function insertLifecycleEvent(tx: ProcurementExecutor, e: LifecycleEventRow): Promise<void> {
  try {
    await tx.insert(procurementProcessLifecycleEventsTable).values(e);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new LifecycleWriteRaceError("event");
    throw err;
  }
}

/** CAS do lifecycle da geração: só grava se a revisão ainda é a esperada. Devolve se gravou. */
export async function updateGenerationLifecycle(tx: ProcurementExecutor, p: {
  organizationId: number; processId: string; expectedRevision: number;
  set: { lifecycleState?: LifecycleState; lineageId?: string; processNumber?: string; generationNo?: number };
}): Promise<boolean> {
  try {
    const res = await tx.update(procurementProcessesTable)
      .set({ ...p.set, lifecycleRevision: p.expectedRevision + 1, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where(and(
        eq(procurementProcessesTable.id, p.processId),
        eq(procurementProcessesTable.organizationId, p.organizationId),
        eq(procurementProcessesTable.lifecycleRevision, p.expectedRevision),
      ));
    const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
    return (header?.affectedRows ?? 0) > 0;
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new LifecycleWriteRaceError("number");
    throw err;
  }
}

/** Nova geração: INSERT puro (id opaco por linhagem/geração). Nunca copia filhos. */
export async function insertNextGeneration(tx: ProcurementExecutor, g: {
  id: string; organizationId: number; processNumber: string; object: string | null; startOption: string;
  responsibleUser: number; correlationId: string; lineageId: string; generationNo: number; supersedesProcessId: string;
}): Promise<void> {
  try {
    await tx.insert(procurementProcessesTable).values({
      id: g.id, organizationId: g.organizationId, processNumber: g.processNumber, object: g.object, modality: "",
      currentStage: "NEW_PROCESS", status: "rascunho", startOption: g.startOption, responsibleUser: g.responsibleUser,
      participants: JSON.stringify([]), activeCopilots: JSON.stringify([]), correlationId: g.correlationId,
      lineageId: g.lineageId, generationNo: g.generationNo, lifecycleState: "active", lifecycleRevision: 0,
      supersedesProcessId: g.supersedesProcessId,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new LifecycleWriteRaceError("lineage");
    throw err;
  }
}

/** Linha bruta mínima da geração (para copiar atributos administrativos na nova geração). */
export async function getGenerationRow(tx: ProcurementExecutor, organizationId: number, processId: string) {
  const rows = await tx.select({
    object: procurementProcessesTable.object, startOption: procurementProcessesTable.startOption,
    responsibleUser: procurementProcessesTable.responsibleUser, processNumber: procurementProcessesTable.processNumber,
  }).from(procurementProcessesTable)
    .where(and(eq(procurementProcessesTable.id, processId), eq(procurementProcessesTable.organizationId, organizationId))).limit(1);
  return rows[0] ?? null;
}

/**
 * Gerações da linhagem do processo informado (QUALQUER estado — leitura histórica), tenant-scoped. Para processo de
 * geração única ainda não materializado (lineage_id NULL), devolve só ele.
 */
export async function listGenerations(organizationId: number, processId: string) {
  const db = await getDb();
  if (!db) return [];
  const cols = {
    id: procurementProcessesTable.id, processNumber: procurementProcessesTable.processNumber,
    lineageId: procurementProcessesTable.lineageId, generationNo: procurementProcessesTable.generationNo,
    lifecycleState: procurementProcessesTable.lifecycleState, lifecycleRevision: procurementProcessesTable.lifecycleRevision,
    supersedesProcessId: procurementProcessesTable.supersedesProcessId, status: procurementProcessesTable.status,
    currentStage: procurementProcessesTable.currentStage, createdAt: procurementProcessesTable.createdAt,
  };
  const self = await db.select(cols).from(procurementProcessesTable)
    .where(and(eq(procurementProcessesTable.id, processId), eq(procurementProcessesTable.organizationId, organizationId))).limit(1);
  if (self.length === 0) return [];
  if (!self[0].lineageId) return self;
  return db.select(cols).from(procurementProcessesTable)
    .where(and(eq(procurementProcessesTable.organizationId, organizationId), eq(procurementProcessesTable.lineageId, self[0].lineageId)))
    .orderBy(procurementProcessesTable.generationNo);
}
