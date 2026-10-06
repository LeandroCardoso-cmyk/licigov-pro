/**
 * FASE 5 — Contratação Direta Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do DirectProcurementWorkspace e agregados
 * (procedimento, propostas, justificativas, documentação, ratificação, publicações).
 * Reutiliza o Timeline Engine (process_timeline) e o Price Research Workspace —
 * NUNCA duplica infraestrutura. Padrão getDb(): degrada sem DB. Multi-tenant.
 * Nomes namespaced para não colidir com o repo legado `server/db/directContracts.ts`.
 */

import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "./connection";
import {
  directProcurementWorkspacesTable, directProcurementProceduresTable,
  proposalCollectionsTable, proposalDocumentsTable, contractJustificationsTable,
  priceJustificationsTable, requiredDocumentsTable, ratificationsTable, generatedPublicationsTable,
  institutionalDecisionsTable, contractWorkspacesTable,
} from "../../drizzle/schema";
import type {
  DirectProcurementWorkspace, DirectProcurementType, DirectProcedureType,
  DirectProcurementStage, DirectProcurementStatus, DirectStartOption, AdaptiveFlags,
} from "../domain/directProcurementWorkspace";
import { DIRECT_DOMAIN_COPILOTS, defaultFlags, type DirectRecordedActs } from "../domain/directProcurementWorkspace";
import type { DirectProcurementProcedure, ProposalCollection, ProposalDocument } from "../domain/directProcurementProcedure";
import type { ContractJustification, PriceJustification, RequiredDocument, Ratification, GeneratedPublication } from "../domain/directProcurementJustifications";
import type { CopilotType } from "../domain/institutionalCopilot";
import { toDbDatetime, fromDbDatetime } from "./institutionalConsultations";
import { recordProcessEvent, isDuplicateKeyError } from "./procurement";
import { ProcessAlreadyExistsError } from "../domain/processCreateContract";
import { splitLineage, type PriceLineage } from "../domain/directPriceReference";

function parseArr<T>(raw: string | null): T[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as T[] : []; } catch { return []; }
}

// C.3A-OPS.3 — Coerção canônica de DATETIME (mesmo mecanismo de server/db/procurement.ts). O domínio
// produz timestamps via `new Date().toISOString()` (com separador `T` e sufixo `Z`), que colunas MySQL
// `DATETIME(3)` em modo estrito rejeitam ("Incorrect datetime value"). `toDb` normaliza na ESCRITA;
// `fromDb` volta a ISO na LEITURA (round-trip determinístico). NÃO cria helper paralelo.
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;
const fromDb = (v: string): string => fromDbDatetime(v) ?? v;

// ─── Workspace ───────────────────────────────────────────────────────────────

const workspaceRow = (ws: DirectProcurementWorkspace) => ({
  id: ws.id, organizationId: ws.organizationId, processNumber: ws.processNumber, object: ws.object,
  procurementType: ws.procurementType, procedureType: ws.procedureType, legalBasis: ws.legalBasis,
  startOption: ws.startOption, currentStage: ws.currentStage, status: ws.status, responsibleUser: ws.responsibleUser,
  participants: JSON.stringify(ws.participants), activeCopilots: JSON.stringify(ws.activeCopilots),
  flags: JSON.stringify(ws.flags), correlationId: ws.correlationId, createdAt: toDb(ws.createdAt), updatedAt: toDb(ws.updatedAt),
});

/**
 * R3 / PR-05 (SEM-003) — CRIA o workspace e o SEU evento inicial de timeline ATOMICAMENTE, com INSERT PURO.
 * Antes, `createProcess` usava o upsert abaixo e, com um número já existente, resetava tipo
 * (dispensa↔inexigibilidade), fundamento legal, procedimento, etapa, status e flags — e anexava outro
 * `workspace_created` à timeline. Agora a PK determinística `dpw:org:número` (= chave natural) recusa a segunda
 * criação (sequencial ou CONCORRENTE): a transação é revertida e lança `ProcessAlreadyExistsError`, sem escrita.
 * Convergência × CONFLICT é decidida pelo router (contrato em `server/domain/processCreateContract.ts`).
 * FAIL-CLOSED: sem banco, LANÇA (criação autoritativa nunca finge sucesso).
 */
export async function createDirectProcurementWorkspaceWithInitialEvent(
  ws: DirectProcurementWorkspace,
  event: { actor: string; summary: string; correlationId: string },
): Promise<DirectProcurementWorkspace> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível — criação de contratação direta não persistida (fail-closed).");
  await db.transaction(async (tx) => {
    try {
      await tx.insert(directProcurementWorkspacesTable).values(workspaceRow(ws));
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new ProcessAlreadyExistsError(ws.id);
      throw err;
    }
    await recordProcessEvent({
      organizationId: ws.organizationId, processId: ws.id, eventType: "workspace_created",
      actor: event.actor, summary: event.summary, refId: ws.id, correlationId: event.correlationId,
      idempotencyKey: "initial", // evento SINGLETON de criação — id estável
    }, tx);
  });
  return ws;
}

/**
 * SALVA (upsert) um workspace JÁ EXISTENTE, carregado por `getDirectProcurementWorkspace` — usado pelas
 * mutações de etapa posterior (fundamento legal, procedimento, flags). NÃO é caminho de criação: criar é
 * `createDirectProcurementWorkspaceWithInitialEvent` (R3 / PR-05).
 */
export async function insertDirectProcurementWorkspace(ws: DirectProcurementWorkspace): Promise<DirectProcurementWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(directProcurementWorkspacesTable).values(workspaceRow(ws)).onDuplicateKeyUpdate({ set: {
    procurementType: ws.procurementType, procedureType: ws.procedureType, legalBasis: ws.legalBasis,
    currentStage: ws.currentStage, status: ws.status, flags: JSON.stringify(ws.flags), updatedAt: toDb(ws.updatedAt),
  } });
  return ws;
}

export async function getDirectProcurementWorkspace(id: string, orgId: number): Promise<DirectProcurementWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(directProcurementWorkspacesTable)
    .where(and(eq(directProcurementWorkspacesTable.id, id), eq(directProcurementWorkspacesTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const flags = (() => {
    try { return r.flags ? JSON.parse(r.flags) as AdaptiveFlags : defaultFlags(r.procurementType as DirectProcurementType, r.startOption as DirectStartOption); }
    catch { return defaultFlags(r.procurementType as DirectProcurementType, r.startOption as DirectStartOption); }
  })();
  return {
    id: r.id, organizationId: r.organizationId, processNumber: r.processNumber, object: r.object ?? "",
    procurementType: r.procurementType as DirectProcurementType, procedureType: r.procedureType as DirectProcedureType,
    legalBasis: r.legalBasis, startOption: r.startOption as DirectStartOption,
    currentStage: r.currentStage as DirectProcurementStage, status: r.status as DirectProcurementStatus,
    responsibleUser: r.responsibleUser, participants: parseArr<number>(r.participants),
    activeCopilots: (parseArr<CopilotType>(r.activeCopilots).length ? parseArr<CopilotType>(r.activeCopilots) : DIRECT_DOMAIN_COPILOTS),
    flags, correlationId: r.correlationId, createdAt: fromDb(r.createdAt), updatedAt: fromDb(r.updatedAt),
  };
}

/**
 * R9 / SEM-064 — ATOS REGISTRADOS que sustentam o status exibido, em LOTE e tenant-scoped (organization_id do
 * contexto): decisão corrente (maior revisão) do ledger `institutional_decisions` e contagem de `generated_publications`
 * por processo. Processo sem ato ⇒ `{ ratification: null, publicationCount: 0 }` (nunca inventado). Sem banco ⇒ vazio.
 */
export async function getRecordedActsForWorkspaces(orgId: number, workspaceIds: readonly string[]): Promise<Map<string, DirectRecordedActs>> {
  const out = new Map<string, DirectRecordedActs>();
  for (const id of workspaceIds) out.set(id, { ratification: null, publicationCount: 0 });
  if (workspaceIds.length === 0) return out;
  const db = await getDb();
  if (!db) return out;
  const ids = [...new Set(workspaceIds)];
  const decisions = await db.select({
    subjectId: institutionalDecisionsTable.subjectId, outcome: institutionalDecisionsTable.outcome,
    revision: institutionalDecisionsTable.revision, decidedAt: institutionalDecisionsTable.decidedAt,
  }).from(institutionalDecisionsTable).where(and(
    eq(institutionalDecisionsTable.organizationId, orgId),
    eq(institutionalDecisionsTable.subjectType, "direct_procurement.ratification"),
    inArray(institutionalDecisionsTable.subjectId, ids),
  )).orderBy(desc(institutionalDecisionsTable.revision));
  const seen = new Set<string>();
  for (const d of decisions) {
    if (seen.has(d.subjectId)) continue; // 1ª linha por assunto = maior revisão = decisão corrente
    seen.add(d.subjectId);
    const prev = out.get(d.subjectId);
    if (prev) out.set(d.subjectId, { ...prev, ratification: { outcome: d.outcome, revision: d.revision, decidedAt: d.decidedAt } });
  }
  const pubs = await db.select({ workspaceId: generatedPublicationsTable.workspaceId, n: count() }).from(generatedPublicationsTable)
    .where(and(eq(generatedPublicationsTable.organizationId, orgId), inArray(generatedPublicationsTable.workspaceId, ids)))
    .groupBy(generatedPublicationsTable.workspaceId);
  for (const p of pubs) {
    const prev = out.get(p.workspaceId);
    if (prev) out.set(p.workspaceId, { ...prev, publicationCount: Number(p.n) });
  }
  return out;
}

export async function listDirectProcurementWorkspaces(orgId: number, limit = 50): Promise<Array<{ id: string; processNumber: string; object: string; procurementType: string; procedureType: string; currentStage: string; status: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(directProcurementWorkspacesTable)
    .where(eq(directProcurementWorkspacesTable.organizationId, orgId))
    .orderBy(desc(directProcurementWorkspacesTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, processNumber: r.processNumber, object: r.object ?? "", procurementType: r.procurementType, procedureType: r.procedureType, currentStage: r.currentStage, status: r.status, updatedAt: fromDb(r.updatedAt) }));
}

export async function updateDirectProcurementStage(id: string, orgId: number, stage: string, status: string, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(directProcurementWorkspacesTable).set({ currentStage: stage, status, updatedAt: toDb(updatedAt) })
    .where(and(eq(directProcurementWorkspacesTable.id, id), eq(directProcurementWorkspacesTable.organizationId, orgId)));
  return true;
}

/**
 * R9 / SEM-064 — reconfigura as flags do fluxo (Adaptive Process Engine) COM evento de timeline, ATOMICAMENTE:
 * lock da linha (tenant-scoped) → relê as flags sob lock (antes/depois verdadeiros) → UPDATE só das flags + evento
 * (id único, ator humano, correlationId) na mesma transação. Nada mudou (replay/no-op) ⇒ nenhuma escrita, nenhum evento.
 * Não regrava etapa/status (o upsert de `insertDirectProcurementWorkspace` sobrescrevia o ponteiro com um valor lido
 * antes). Sem banco ⇒ lança (fail-closed). Workspace ausente neste órgão ⇒ `null` (o router responde NOT_FOUND neutro).
 */
export async function updateDirectWorkspaceFlagsWithEvent(p: {
  workspaceId: string; organizationId: number; patch: Partial<AdaptiveFlags>;
  actor: string; correlationId: string; describe: (before: AdaptiveFlags, after: AdaptiveFlags) => { summary: string; eventType: string } | null;
}): Promise<{ changed: boolean; before: AdaptiveFlags; after: AdaptiveFlags } | null> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível — configuração do fluxo não persistida (fail-closed).");
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(directProcurementWorkspacesTable)
      .where(and(eq(directProcurementWorkspacesTable.id, p.workspaceId), eq(directProcurementWorkspacesTable.organizationId, p.organizationId)))
      .for("update").limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    const before: AdaptiveFlags = (() => {
      try { return r.flags ? JSON.parse(r.flags) as AdaptiveFlags : defaultFlags(r.procurementType as DirectProcurementType, r.startOption as DirectStartOption); }
      catch { return defaultFlags(r.procurementType as DirectProcurementType, r.startOption as DirectStartOption); }
    })();
    const after: AdaptiveFlags = { ...before, ...p.patch };
    const change = p.describe(before, after);
    if (!change) return { changed: false, before, after: before };
    await tx.update(directProcurementWorkspacesTable)
      .set({ flags: JSON.stringify(after), updatedAt: toDb(new Date().toISOString()) })
      .where(and(eq(directProcurementWorkspacesTable.id, p.workspaceId), eq(directProcurementWorkspacesTable.organizationId, p.organizationId)));
    await recordProcessEvent({
      organizationId: p.organizationId, processId: p.workspaceId, eventType: change.eventType, actor: p.actor,
      summary: change.summary, refId: p.workspaceId, correlationId: p.correlationId,
    }, tx);
    return { changed: true, before, after };
  });
}

/**
 * R9 / SEM-064 — contratos REGISTRADOS vinculados a esta contratação direta (origem `contratacao_direta`), tenant-scoped.
 * Base para decidir se um extrato de contrato pode existir. Só o essencial (sem PII além do contratado informado).
 */
export async function listLinkedContractsForDirect(orgId: number, directWorkspaceId: string): Promise<Array<{
  id: string; contractNumber: string; contractor: string; object: string; value: number; term: string; status: string;
}>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(contractWorkspacesTable).where(and(
    eq(contractWorkspacesTable.organizationId, orgId),
    eq(contractWorkspacesTable.originType, "contratacao_direta"),
    eq(contractWorkspacesTable.originProcess, directWorkspaceId),
    ne(contractWorkspacesTable.status, "arquivado"),
  )).orderBy(desc(contractWorkspacesTable.createdAt));
  return rows.map((r) => ({ id: r.id, contractNumber: r.contractNumber, contractor: r.contractor, object: r.object ?? "", value: Number(r.value), term: r.term, status: r.status }));
}

// ─── Procedure ───────────────────────────────────────────────────────────────

export async function insertDirectProcedure(p: DirectProcurementProcedure): Promise<DirectProcurementProcedure | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(directProcurementProceduresTable).values({
    id: p.id, organizationId: p.organizationId, workspaceId: p.workspaceId, procedureType: p.procedureType,
    platform: p.platform, receiptMethod: p.receiptMethod, instructions: p.instructions, correlationId: p.correlationId, createdAt: toDb(p.createdAt),
  }).onDuplicateKeyUpdate({ set: { procedureType: p.procedureType, platform: p.platform, receiptMethod: p.receiptMethod, instructions: p.instructions } });
  return p;
}

export async function getDirectProcedure(workspaceId: string, orgId: number): Promise<{ id: string; procedureType: string; platform: string | null; receiptMethod: string | null; instructions: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(directProcurementProceduresTable)
    .where(and(eq(directProcurementProceduresTable.workspaceId, workspaceId), eq(directProcurementProceduresTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, procedureType: r.procedureType, platform: r.platform ?? null, receiptMethod: r.receiptMethod ?? null, instructions: r.instructions ?? "" };
}

// ─── Proposals ───────────────────────────────────────────────────────────────

export async function insertProposalCollection(p: ProposalCollection): Promise<ProposalCollection | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(proposalCollectionsTable).values({
    id: p.id, organizationId: p.organizationId, workspaceId: p.workspaceId, supplierName: p.supplierName,
    supplierDocument: p.supplierDocument, proposalValue: String(p.proposalValue), protocol: p.protocol,
    receivedVia: p.receivedVia, correlationId: p.correlationId, createdAt: toDb(p.createdAt),
  }).onDuplicateKeyUpdate({ set: { proposalValue: String(p.proposalValue), protocol: p.protocol } });
  return p;
}

export async function listProposalCollections(workspaceId: string, orgId: number): Promise<Array<{ id: string; supplierName: string; supplierDocument: string; proposalValue: number; protocol: string; receivedVia: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(proposalCollectionsTable)
    .where(and(eq(proposalCollectionsTable.workspaceId, workspaceId), eq(proposalCollectionsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, supplierName: r.supplierName, supplierDocument: r.supplierDocument, proposalValue: Number(r.proposalValue), protocol: r.protocol, receivedVia: r.receivedVia }));
}

export async function insertProposalDocument(d: ProposalDocument): Promise<ProposalDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(proposalDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, proposalId: d.proposalId, workspaceId: d.workspaceId,
    kind: d.kind, title: d.title, documentReference: d.documentReference, correlationId: d.correlationId, createdAt: toDb(d.createdAt),
  }).onDuplicateKeyUpdate({ set: { title: d.title } });
  return d;
}

export async function listProposalDocuments(proposalId: string, orgId: number): Promise<Array<{ id: string; kind: string; title: string; documentReference: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(proposalDocumentsTable)
    .where(and(eq(proposalDocumentsTable.proposalId, proposalId), eq(proposalDocumentsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, documentReference: r.documentReference }));
}

// ─── Contract justification ──────────────────────────────────────────────────

export async function upsertContractJustification(j: ContractJustification): Promise<ContractJustification | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractJustificationsTable).values({
    id: j.id, organizationId: j.organizationId, workspaceId: j.workspaceId, need: j.need, publicInterest: j.publicInterest,
    motivation: j.motivation, legalFoundation: j.legalFoundation, benefits: j.benefits, alternatives: j.alternatives,
    correlationId: j.correlationId, createdAt: toDb(j.createdAt), updatedAt: toDb(j.updatedAt),
  }).onDuplicateKeyUpdate({ set: {
    need: j.need, publicInterest: j.publicInterest, motivation: j.motivation, legalFoundation: j.legalFoundation,
    benefits: j.benefits, alternatives: j.alternatives, updatedAt: toDb(j.updatedAt),
  } });
  return j;
}

export async function getContractJustification(workspaceId: string, orgId: number): Promise<ContractJustification | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contractJustificationsTable)
    .where(and(eq(contractJustificationsTable.workspaceId, workspaceId), eq(contractJustificationsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, organizationId: r.organizationId, workspaceId: r.workspaceId, need: r.need ?? "", publicInterest: r.publicInterest ?? "", motivation: r.motivation ?? "", legalFoundation: r.legalFoundation ?? "", benefits: r.benefits ?? "", alternatives: r.alternatives ?? "", correlationId: r.correlationId, createdAt: fromDb(r.createdAt), updatedAt: fromDb(r.updatedAt) };
}

// ─── Price justification ─────────────────────────────────────────────────────

export async function upsertPriceJustification(j: PriceJustification): Promise<PriceJustification | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(priceJustificationsTable).values({
    id: j.id, organizationId: j.organizationId, workspaceId: j.workspaceId, source: j.source, justification: j.justification,
    referenceValue: String(j.referenceValue), researchId: j.researchId, documentReferences: JSON.stringify(j.documentReferences),
    correlationId: j.correlationId, createdAt: toDb(j.createdAt),
  }).onDuplicateKeyUpdate({ set: { source: j.source, justification: j.justification, referenceValue: String(j.referenceValue), researchId: j.researchId, documentReferences: JSON.stringify(j.documentReferences) } });
  return j;
}

export async function getPriceJustification(workspaceId: string, orgId: number): Promise<{ id: string; source: string; justification: string; referenceValue: number; researchId: string; documentReferences: string[]; lineage: PriceLineage | null } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(priceJustificationsTable)
    .where(and(eq(priceJustificationsTable.workspaceId, workspaceId), eq(priceJustificationsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  // R9 / SEM-042 — a linhagem (emitida só pelo servidor) vem num token reservado das referências; aqui é separada.
  const { lineage, references } = splitLineage(parseArr<string>(r.documentReferences));
  return { id: r.id, source: r.source, justification: r.justification ?? "", referenceValue: Number(r.referenceValue), researchId: r.researchId, documentReferences: references, lineage };
}

// ─── Required documents (checklist) ──────────────────────────────────────────

export async function insertRequiredDocument(d: RequiredDocument): Promise<RequiredDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(requiredDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, workspaceId: d.workspaceId, name: d.name, required: d.required ? 1 : 0,
    status: d.status, documentReference: d.documentReference, correlationId: d.correlationId,
  }).onDuplicateKeyUpdate({ set: { status: d.status, documentReference: d.documentReference } });
  return d;
}

export interface RequiredDocumentRow {
  id: string; name: string; required: boolean; status: string; documentReference: string;
  /** R7 / PR-16 — evidência real (0314). */
  contentHash: string; sizeBytes: number; mimeType: string;
  attachedBy: number | null; attachedAt: string | null; validatedBy: number | null; validatedAt: string | null;
}

function toRequiredDocumentRow(r: typeof requiredDocumentsTable.$inferSelect): RequiredDocumentRow {
  return {
    id: r.id, name: r.name, required: r.required === 1, status: r.status, documentReference: r.documentReference,
    contentHash: r.contentHash, sizeBytes: r.sizeBytes, mimeType: r.mimeType,
    attachedBy: r.attachedBy ?? null, attachedAt: r.attachedAt ?? null, validatedBy: r.validatedBy ?? null, validatedAt: r.validatedAt ?? null,
  };
}

export async function listRequiredDocuments(workspaceId: string, orgId: number): Promise<RequiredDocumentRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(requiredDocumentsTable)
    .where(and(eq(requiredDocumentsTable.workspaceId, workspaceId), eq(requiredDocumentsTable.organizationId, orgId)));
  return rows.map(toRequiredDocumentRow);
}

/** R7 / PR-16 — um item do checklist, tenant- E workspace-scoped (outro workspace/órgão ⇒ null). */
export async function getRequiredDocument(id: string, workspaceId: string, orgId: number): Promise<RequiredDocumentRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(requiredDocumentsTable)
    .where(and(eq(requiredDocumentsTable.id, id), eq(requiredDocumentsTable.workspaceId, workspaceId), eq(requiredDocumentsTable.organizationId, orgId))).limit(1);
  return rows.length ? toRequiredDocumentRow(rows[0]) : null;
}

/**
 * R7 / PR-16 (SEM-020) — muda só o STATUS (a referência nunca vem do cliente). `validado` registra quem validou.
 */
export async function updateRequiredDocumentStatus(id: string, workspaceId: string, orgId: number, status: "pendente" | "validado", actorUserId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(requiredDocumentsTable)
    .set(status === "validado" ? { status, validatedBy: actorUserId, validatedAt: toDb(new Date().toISOString()) } : { status, validatedBy: null, validatedAt: null })
    .where(and(eq(requiredDocumentsTable.id, id), eq(requiredDocumentsTable.workspaceId, workspaceId), eq(requiredDocumentsTable.organizationId, orgId)));
  return true;
}

/** R7 / PR-16 (SEM-020) — grava a evidência do upload REAL (chave emitida pelo servidor + SHA-256). */
export async function recordRequiredDocumentAttachment(p: {
  id: string; workspaceId: string; organizationId: number; storageKey: string; contentHash: string; sizeBytes: number; mimeType: string; actorUserId: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(requiredDocumentsTable).set({
    status: "anexado", documentReference: p.storageKey, contentHash: p.contentHash, sizeBytes: p.sizeBytes, mimeType: p.mimeType,
    attachedBy: p.actorUserId, attachedAt: toDb(new Date().toISOString()), validatedBy: null, validatedAt: null,
  }).where(and(eq(requiredDocumentsTable.id, p.id), eq(requiredDocumentsTable.workspaceId, p.workspaceId), eq(requiredDocumentsTable.organizationId, p.organizationId)));
  return true;
}

// ─── Ratification ────────────────────────────────────────────────────────────

/**
 * @deprecated R4 / PR-07 — upsert LEGADO da ratificação (reescrevia decisão/justificativa e mantinha o 1º responsável,
 * SEM-004). Não há mais caller de produção: o registro é `institutionalDecisionService` (ledger append-only, 0312).
 * A tabela `ratifications` segue como HISTÓRICO legível (`getRatification`).
 */
export async function insertRatification(r: Ratification): Promise<Ratification | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(ratificationsTable).values({
    id: r.id, organizationId: r.organizationId, workspaceId: r.workspaceId, responsible: r.responsible,
    decision: r.decision, justification: r.justification, evidence: JSON.stringify(r.evidence), correlationId: r.correlationId, ratifiedAt: toDb(r.ratifiedAt),
  }).onDuplicateKeyUpdate({ set: { decision: r.decision, justification: r.justification, evidence: JSON.stringify(r.evidence) } });
  return r;
}

export async function getRatification(workspaceId: string, orgId: number): Promise<{ id: string; responsible: number; decision: string; justification: string; evidence: string[]; ratifiedAt: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(ratificationsTable)
    .where(and(eq(ratificationsTable.workspaceId, workspaceId), eq(ratificationsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, responsible: r.responsible, decision: r.decision, justification: r.justification ?? "", evidence: parseArr<string>(r.evidence), ratifiedAt: fromDb(r.ratifiedAt) };
}

// ─── Publications ────────────────────────────────────────────────────────────

export async function insertGeneratedPublication(p: GeneratedPublication): Promise<GeneratedPublication | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(generatedPublicationsTable).values({
    id: p.id, organizationId: p.organizationId, workspaceId: p.workspaceId, kind: p.kind, title: p.title,
    content: p.content, correlationId: p.correlationId, createdAt: toDb(p.createdAt),
  }).onDuplicateKeyUpdate({ set: { content: p.content, title: p.title } });
  return p;
}

export async function listGeneratedPublications(workspaceId: string, orgId: number): Promise<Array<{ id: string; kind: string; title: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(generatedPublicationsTable)
    .where(and(eq(generatedPublicationsTable.workspaceId, workspaceId), eq(generatedPublicationsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, createdAt: fromDb(r.createdAt) }));
}
