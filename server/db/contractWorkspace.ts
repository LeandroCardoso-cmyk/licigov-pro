/**
 * FASE 5 — Contratos Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do ContractWorkspace e instrumentos (aditivos,
 * apostilamentos, ocorrências, documentos gerados, contratos importados). Reutiliza
 * o Timeline Engine (process_timeline). Padrão getDb(): degrada sem DB. Multi-tenant.
 * Nomes namespaced para não colidir com o repo legado `server/db/contracts.ts`.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import {
  contractWorkspacesTable, contractWsDocumentsTable, contractAddendaTable,
  contractWsApostillesTable, contractOccurrencesTable, importedContractsTable,
} from "../../drizzle/schema";
import type { ContractWorkspace, ContractOriginType, ContractStatus } from "../domain/contractWorkspace";
import type {
  ContractAddendum, AddendumType, AddendumStatus, ContractApostille, ApostilleKind,
  ContractOccurrence, ContractGeneratedDocument, ContractDocumentKind, MinutaMetadata,
} from "../domain/contractInstruments";
import type { ImportedContract, ImportedContractSource, ReconstructedContractFields } from "../domain/contractReconstruction";

function parseArr(raw: string | null): string[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as string[] : []; } catch { return []; }
}

/**
 * Fronteira de data ISO ⇄ MySQL (mesmo bug/fix do #163: colunas DATETIME(3) rejeitam
 * o separador "T" e o sufixo "Z" do ISO 8601 — o INSERT falha em produção; nunca
 * apareceu antes porque este arquivo nunca tinha sido exercitado contra MySQL real,
 * só "degrada sem DB" nos testes existentes). Aplicado aqui em insertContractWorkspace/
 * getContractWorkspace (usadas pelos 4 fluxos de nascimento do contrato, incluindo o
 * avulso). NOTA: o mesmo padrão quebrado existe em insertContractWsDocument,
 * insertContractAddendum, insertContractApostille, insertContractOccurrence e
 * insertImportedContract deste mesmo arquivo — fora do escopo desta correção (PR B),
 * registrado no relatório da revisão arquitetural como bug pré-existente a corrigir.
 */
function toDbDatetime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}
function fromDbDatetime(v: string): string {
  if (v.includes("T")) return v.endsWith("Z") ? v : `${v}Z`;
  return `${v.replace(" ", "T")}Z`;
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export async function insertContractWorkspace(ws: ContractWorkspace): Promise<ContractWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractWorkspacesTable).values({
    id: ws.id, organizationId: ws.organizationId, originType: ws.originType, originProcess: ws.originProcess,
    contractNumber: ws.contractNumber, contractor: ws.contractor, object: ws.object, value: String(ws.value),
    term: ws.term, status: ws.status, manager: ws.manager, inspector: ws.inspector,
    correlationId: ws.correlationId, createdBy: ws.createdBy,
    createdAt: toDbDatetime(ws.createdAt), updatedAt: toDbDatetime(ws.updatedAt),
  }).onDuplicateKeyUpdate({ set: {
    contractor: ws.contractor, object: ws.object, value: String(ws.value), term: ws.term, status: ws.status,
    manager: ws.manager, inspector: ws.inspector, contractNumber: ws.contractNumber, updatedAt: toDbDatetime(ws.updatedAt),
  } });
  return ws;
}

export async function getContractWorkspace(id: string, orgId: number): Promise<ContractWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contractWorkspacesTable)
    .where(and(eq(contractWorkspacesTable.id, id), eq(contractWorkspacesTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, organizationId: r.organizationId, originType: r.originType as ContractOriginType, originProcess: r.originProcess,
    contractNumber: r.contractNumber, contractor: r.contractor, object: r.object ?? "", value: Number(r.value), term: r.term,
    status: r.status as ContractStatus, manager: r.manager, inspector: r.inspector,
    activeCopilots: ["juridico", "contratos", "agente_contratacao"], correlationId: r.correlationId,
    createdBy: r.createdBy ?? null, createdAt: fromDbDatetime(r.createdAt), updatedAt: fromDbDatetime(r.updatedAt),
  };
}

/**
 * Busca um contrato AVULSO existente pelo número, na mesma organização — usada para
 * detectar colisão ANTES de criar (unicidade institucional do contrato avulso; ver
 * revisão arquitetural). Não cobre os outros 3 fluxos (processo/direta/externo),
 * que já são naturalmente escopados pelo id determinístico incluindo originType.
 */
export async function findManualContractByNumber(orgId: number, contractNumber: string): Promise<{ id: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ id: contractWorkspacesTable.id }).from(contractWorkspacesTable)
    .where(and(
      eq(contractWorkspacesTable.organizationId, orgId),
      eq(contractWorkspacesTable.originType, "avulso"),
      eq(contractWorkspacesTable.contractNumber, contractNumber),
    )).limit(1);
  return rows.length > 0 ? { id: rows[0].id } : null;
}

export async function listContractWorkspaces(orgId: number, limit = 50): Promise<Array<{ id: string; originType: string; contractNumber: string; contractor: string; object: string; value: number; status: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(contractWorkspacesTable)
    .where(eq(contractWorkspacesTable.organizationId, orgId)).orderBy(desc(contractWorkspacesTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, originType: r.originType, contractNumber: r.contractNumber, contractor: r.contractor, object: r.object ?? "", value: Number(r.value), status: r.status, updatedAt: r.updatedAt }));
}

export async function listImportedContractWorkspaces(orgId: number, limit = 50): Promise<Array<{ id: string; contractNumber: string; contractor: string; object: string; value: number; status: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(contractWorkspacesTable)
    .where(and(eq(contractWorkspacesTable.organizationId, orgId), eq(contractWorkspacesTable.originType, "externo")))
    .orderBy(desc(contractWorkspacesTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, contractNumber: r.contractNumber, contractor: r.contractor, object: r.object ?? "", value: Number(r.value), status: r.status, updatedAt: r.updatedAt }));
}

export async function updateContractWorkspaceStatus(id: string, orgId: number, status: string, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(contractWorkspacesTable).set({ status, updatedAt: toDbDatetime(updatedAt) })
    .where(and(eq(contractWorkspacesTable.id, id), eq(contractWorkspacesTable.organizationId, orgId)));
  return true;
}

// ─── Generated documents (minutas) ────────────────────────────────────────────

export async function insertContractWsDocument(d: ContractGeneratedDocument): Promise<ContractGeneratedDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractWsDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, contractId: d.contractId, kind: d.kind, title: d.title,
    content: d.content, refId: d.refId, metadata: JSON.stringify(d.metadata), correlationId: d.correlationId, createdAt: d.createdAt,
  }).onDuplicateKeyUpdate({ set: { content: d.content, title: d.title, metadata: JSON.stringify(d.metadata) } });
  return d;
}

export async function listContractWsDocuments(contractId: string, orgId: number): Promise<Array<{ id: string; kind: string; title: string; metadata: MinutaMetadata | null; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(contractWsDocumentsTable)
    .where(and(eq(contractWsDocumentsTable.contractId, contractId), eq(contractWsDocumentsTable.organizationId, orgId)))
    .orderBy(asc(contractWsDocumentsTable.createdAt));
  return rows.map(r => {
    let metadata: MinutaMetadata | null = null;
    try { metadata = r.metadata ? JSON.parse(r.metadata) as MinutaMetadata : null; } catch { metadata = null; }
    return { id: r.id, kind: r.kind, title: r.title, metadata, createdAt: r.createdAt };
  });
}

// ─── Addenda ─────────────────────────────────────────────────────────────────

export async function countContractAddenda(contractId: string, orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: contractAddendaTable.id }).from(contractAddendaTable)
    .where(and(eq(contractAddendaTable.contractId, contractId), eq(contractAddendaTable.organizationId, orgId)));
  return rows.length;
}

export async function insertContractAddendum(a: ContractAddendum): Promise<ContractAddendum | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractAddendaTable).values({
    id: a.id, organizationId: a.organizationId, contractId: a.contractId, addendumType: a.addendumType, sequence: a.sequence,
    justification: a.justification, newValue: String(a.newValue), newTerm: a.newTerm, status: a.status, requestOrigin: a.requestOrigin,
    documentReference: a.documentReference, legalOpinionRequestId: a.legalOpinionRequestId, correlationId: a.correlationId,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  }).onDuplicateKeyUpdate({ set: { status: a.status, justification: a.justification, documentReference: a.documentReference, legalOpinionRequestId: a.legalOpinionRequestId, updatedAt: a.updatedAt } });
  return a;
}

export async function listContractAddenda(contractId: string, orgId: number): Promise<Array<{ id: string; addendumType: string; sequence: number; justification: string; newValue: number; newTerm: string; status: string; requestOrigin: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(contractAddendaTable)
    .where(and(eq(contractAddendaTable.contractId, contractId), eq(contractAddendaTable.organizationId, orgId)))
    .orderBy(asc(contractAddendaTable.sequence));
  return rows.map(r => ({ id: r.id, addendumType: r.addendumType, sequence: r.sequence, justification: r.justification ?? "", newValue: Number(r.newValue), newTerm: r.newTerm, status: r.status, requestOrigin: r.requestOrigin }));
}

// ─── Apostilles ──────────────────────────────────────────────────────────────

export async function countContractApostilles(contractId: string, orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: contractWsApostillesTable.id }).from(contractWsApostillesTable)
    .where(and(eq(contractWsApostillesTable.contractId, contractId), eq(contractWsApostillesTable.organizationId, orgId)));
  return rows.length;
}

export async function insertContractApostille(a: ContractApostille): Promise<ContractApostille | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractWsApostillesTable).values({
    id: a.id, organizationId: a.organizationId, contractId: a.contractId, kind: a.kind, sequence: a.sequence,
    description: a.description, newValue: String(a.newValue), newManager: a.newManager, newInspector: a.newInspector,
    documentReference: a.documentReference, correlationId: a.correlationId, createdAt: a.createdAt,
  }).onDuplicateKeyUpdate({ set: { description: a.description, documentReference: a.documentReference } });
  return a;
}

export async function listContractApostilles(contractId: string, orgId: number): Promise<Array<{ id: string; kind: string; sequence: number; description: string; newValue: number; newManager: string; newInspector: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(contractWsApostillesTable)
    .where(and(eq(contractWsApostillesTable.contractId, contractId), eq(contractWsApostillesTable.organizationId, orgId)))
    .orderBy(asc(contractWsApostillesTable.sequence));
  return rows.map(r => ({ id: r.id, kind: r.kind, sequence: r.sequence, description: r.description ?? "", newValue: Number(r.newValue), newManager: r.newManager, newInspector: r.newInspector }));
}

// ─── Occurrences ─────────────────────────────────────────────────────────────

export async function insertContractOccurrence(o: ContractOccurrence): Promise<ContractOccurrence | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractOccurrencesTable).values({
    id: o.id, organizationId: o.organizationId, contractId: o.contractId, description: o.description,
    occurredOn: o.occurredOn, attachments: JSON.stringify(o.attachments), notes: o.notes, correlationId: o.correlationId, createdAt: o.createdAt,
  }).onDuplicateKeyUpdate({ set: { notes: o.notes } });
  return o;
}

export async function listContractOccurrences(contractId: string, orgId: number): Promise<Array<{ id: string; description: string; occurredOn: string; attachments: string[]; notes: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(contractOccurrencesTable)
    .where(and(eq(contractOccurrencesTable.contractId, contractId), eq(contractOccurrencesTable.organizationId, orgId)))
    .orderBy(asc(contractOccurrencesTable.createdAt));
  return rows.map(r => ({ id: r.id, description: r.description ?? "", occurredOn: r.occurredOn, attachments: parseArr(r.attachments), notes: r.notes ?? "", createdAt: r.createdAt }));
}

// ─── Imported contracts ──────────────────────────────────────────────────────

export async function insertImportedContract(ic: ImportedContract, contractId: string): Promise<ImportedContract | null> {
  const db = await getDb();
  if (!db) return null;
  // A coluna `extracted` (nome físico legado) guarda a reconstrução assistida.
  await db.insert(importedContractsTable).values({
    id: ic.id, organizationId: ic.organizationId, contractId, source: ic.source, rawTextHash: ic.rawTextHash,
    extracted: JSON.stringify(ic.reconstructed), confidence: String(ic.confidence), correlationId: ic.correlationId,
    createdAt: toDbDatetime(ic.createdAt),
  }).onDuplicateKeyUpdate({ set: { contractId, extracted: JSON.stringify(ic.reconstructed), confidence: String(ic.confidence) } });
  return ic;
}

export async function getImportedContract(id: string, orgId: number): Promise<{ id: string; contractId: string; source: ImportedContractSource; reconstructed: ReconstructedContractFields | null; confidence: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(importedContractsTable)
    .where(and(eq(importedContractsTable.id, id), eq(importedContractsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  let reconstructed: ReconstructedContractFields | null = null;
  try { reconstructed = r.extracted ? JSON.parse(r.extracted) as ReconstructedContractFields : null; } catch { reconstructed = null; }
  return { id: r.id, contractId: r.contractId, source: r.source as ImportedContractSource, reconstructed, confidence: Number(r.confidence) };
}
