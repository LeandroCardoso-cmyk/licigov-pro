/**
 * FASE 5 — Contratos Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do ContractWorkspace e instrumentos (aditivos,
 * apostilamentos, ocorrências, documentos gerados, contratos importados). Reutiliza
 * o Timeline Engine (process_timeline). Padrão getDb(): degrada sem DB. Multi-tenant.
 * Nomes namespaced para não colidir com o repo legado `server/db/contracts.ts`.
 */

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import { CONTRACT_ALREADY_EXISTS } from "../domain/contractCreation";
import {
  contractWorkspacesTable, contractWsDocumentsTable, contractAddendaTable,
  contractWsApostillesTable, contractOccurrencesTable, importedContractsTable,
} from "../../drizzle/schema";
import type { ContractWorkspace, ContractOriginType, ContractStatus } from "../domain/contractWorkspace";
import type {
  ContractAddendum, ContractApostille,
  ContractOccurrence, ContractGeneratedDocument, MinutaMetadata,
} from "../domain/contractInstruments";
import type { ImportedContract, ImportedContractSource, ReconstructedContractFields } from "../domain/contractReconstruction";

// Executor: a conexão (db) ou uma transação (tx) — permite compor instrumento + status + timeline
// atomicamente (SEM-025). Ausente ⇒ getDb(), assinatura compatível com os callers existentes.
type ContractWsDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type ContractWsExecutor = ContractWsDb | Parameters<Parameters<ContractWsDb["transaction"]>[0]>[0];

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

/** ER_DUP_ENTRY (1062) do MySQL/MariaDB, inclusive encapsulado pelo driver/drizzle. */
function isDuplicateKeyError(err: unknown): boolean {
  let x: unknown = err;
  for (let i = 0; i < 4 && x && typeof x === "object"; i++) {
    const e = x as { code?: string; errno?: number; cause?: unknown };
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
    x = e.cause;
  }
  return false;
}

/**
 * Upsert legado — usado SÓ pela edição (`updateContract`, escopo da PR-12). R3 / PR-06 (0310): a coluna gerada
 * `normalized_number` acompanha `contract_number`; renomear para um número que outro contrato da organização já usa
 * viola UNIQUE(organization_id, normalized_number) — o statement falha INTEIRO (nada gravado) e vira CONFLICT governado
 * `CONTRACT_ALREADY_EXISTS` em vez de 500.
 */
export async function insertContractWorkspace(ws: ContractWorkspace): Promise<ContractWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  try {
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
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    throw new TRPCError({
      code: "CONFLICT",
      message: `Já existe outro contrato com o número "${ws.contractNumber}" nesta organização. O número do contrato é único na organização, qualquer que seja a origem; nada foi alterado (${CONTRACT_ALREADY_EXISTS}).`,
    });
  }
  return ws;
}

/**
 * R3 / PR-06 (SEM-007) — CRIAÇÃO do contrato: INSERT puro, NUNCA upsert. Sobre a PRIMARY KEY existente
 * hash(org, origem, número) devolve "duplicate" sem escrever nada; o serviço decide convergir ou CONFLICT.
 * (`insertContractWorkspace`, o upsert, segue restrito à edição `updateContract` — escopo da PR-12.) Sem DB ⇒ null.
 */
export async function insertNewContractWorkspace(ws: ContractWorkspace): Promise<"inserted" | "duplicate" | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    await db.insert(contractWorkspacesTable).values({
      id: ws.id, organizationId: ws.organizationId, originType: ws.originType, originProcess: ws.originProcess,
      contractNumber: ws.contractNumber, contractor: ws.contractor, object: ws.object, value: String(ws.value),
      term: ws.term, status: ws.status, manager: ws.manager, inspector: ws.inspector,
      correlationId: ws.correlationId, createdBy: ws.createdBy,
      createdAt: toDbDatetime(ws.createdAt), updatedAt: toDbDatetime(ws.updatedAt),
    });
    return "inserted";
  } catch (err) {
    if (isDuplicateKeyError(err)) return "duplicate";
    throw err;
  }
}

/**
 * R3 / PR-06 — OUTRO contrato da organização com o MESMO número oficial normalizado (qualquer origem). Só leitura de
 * OBSERVABILIDADE enquanto CONTRACT_NUMBER_SCOPE (HD-15) estiver pendente — não decide criação. Coluna gerada
 * `normalized_number` (utf8mb4_bin — exata, índice idx_ctw_org_normalized_number). Sem DB ⇒ null (degrada).
 */
export async function findContractByNormalizedNumber(orgId: number, normalizedNumber: string, excludeId?: string): Promise<ContractWorkspace | null> {
  const db = await getDb();
  if (!db || !normalizedNumber) return null;
  const rows = await db.select({ id: contractWorkspacesTable.id }).from(contractWorkspacesTable)
    .where(and(
      eq(contractWorkspacesTable.organizationId, orgId),
      eq(contractWorkspacesTable.normalizedNumber, normalizedNumber),
      ...(excludeId ? [ne(contractWorkspacesTable.id, excludeId)] : []),
    )).limit(1);
  return rows.length > 0 ? getContractWorkspace(rows[0].id, orgId) : null;
}

function rowToWorkspace(r: typeof contractWorkspacesTable.$inferSelect): ContractWorkspace {
  return {
    id: r.id, organizationId: r.organizationId, originType: r.originType as ContractOriginType, originProcess: r.originProcess,
    contractNumber: r.contractNumber, contractor: r.contractor, object: r.object ?? "", value: Number(r.value), term: r.term,
    status: r.status as ContractStatus, manager: r.manager, inspector: r.inspector,
    activeCopilots: ["juridico", "contratos", "agente_contratacao"], correlationId: r.correlationId,
    createdBy: r.createdBy ?? null, createdAt: fromDbDatetime(r.createdAt), updatedAt: fromDbDatetime(r.updatedAt),
  };
}

export async function getContractWorkspace(id: string, orgId: number): Promise<ContractWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contractWorkspacesTable)
    .where(and(eq(contractWorkspacesTable.id, id), eq(contractWorkspacesTable.organizationId, orgId))).limit(1);
  return rows.length === 0 ? null : rowToWorkspace(rows[0]);
}

/**
 * R9 / SEM-084 — TRAVA a linha do contrato (`SELECT … FOR UPDATE`, tenant-scoped) DENTRO da transação do instrumento
 * e devolve o estado do contrato SOB o lock. Todo criador de aditivo/apostilamento passa por aqui antes de alocar a
 * sequência e de avaliar a máquina de estados: instrumentos concorrentes do mesmo contrato se SERIALIZAM nesta linha
 * (o segundo espera o commit do primeiro e então lê o status e a sequência já atualizados). Exige executor
 * transacional; contrato inexistente no tenant ⇒ null (a trava não pega nada). Sem chamada remota sob o lock.
 */
export async function lockContractWorkspaceForInstrument(id: string, orgId: number, tx: ContractWsExecutor): Promise<ContractWorkspace | null> {
  const rows = await tx.select().from(contractWorkspacesTable)
    .where(and(eq(contractWorkspacesTable.id, id), eq(contractWorkspacesTable.organizationId, orgId)))
    .limit(1).for("update");
  return rows.length === 0 ? null : rowToWorkspace(rows[0]);
}

/**
 * SEM-023 — gravação da edição do contrato por COMPARE-AND-SET da revisão (`updated_at`, DATETIME(3)).
 * Numa ÚNICA sentença SQL:
 *   UPDATE contract_workspaces SET contract_number=?, contractor=?, object=?, value=?, term=?, status=?,
 *          manager=?, inspector=?, updated_at=? WHERE id=? AND organization_id=? AND updated_at=?
 * Grava somente se a revisão persistida ainda for `expectedUpdatedAt`; `ws.updatedAt` precisa ser
 * estritamente posterior (ver `nextContractRevision`), então de dois salvamentos concorrentes com a
 * mesma revisão exatamente um casa. Nunca insere (não é upsert) e nunca toca id/origem/tenant/createdBy.
 * Retorna `false` quando 0 linhas casam (revisão mudou em paralelo, ou contrato inexistente no tenant):
 * nesse caso NADA foi gravado. Degrada sem DB (`false`).
 */
export async function compareAndSetContractWorkspace(ws: ContractWorkspace, expectedUpdatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  let result: unknown;
  try {
    result = await db.update(contractWorkspacesTable)
      .set({
        contractNumber: ws.contractNumber, contractor: ws.contractor, object: ws.object, value: String(ws.value),
        term: ws.term, status: ws.status, manager: ws.manager, inspector: ws.inspector, updatedAt: toDbDatetime(ws.updatedAt),
      })
      .where(and(
        eq(contractWorkspacesTable.id, ws.id),
        eq(contractWorkspacesTable.organizationId, ws.organizationId),
        eq(contractWorkspacesTable.updatedAt, toDbDatetime(expectedUpdatedAt)),
      ));
  } catch (err) {
    // Integração PR-06 × PR-12: renomear para um número já usado por outro contrato da organização viola
    // UNIQUE(organization_id, normalized_number) (0310). O UPDATE falha INTEIRO (nada gravado) ⇒ CONFLICT
    // governado `CONTRACT_ALREADY_EXISTS` (mesma recusa que o upsert legado emitia), nunca 500.
    if (!isDuplicateKeyError(err)) throw err;
    throw new TRPCError({
      code: "CONFLICT",
      message: `Já existe outro contrato com o número "${ws.contractNumber}" nesta organização. O número do contrato é único na organização, qualquer que seja a origem; nada foi alterado (${CONTRACT_ALREADY_EXISTS}).`,
    });
  }
  const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
  return (header?.affectedRows ?? 0) > 0;
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

/**
 * SEM-025 — mudança de status do contrato por COMPARE-AND-SET (substitui o antigo
 * `updateContractWorkspaceStatus`, que gravava qualquer status sem conferir o atual e permitia a um
 * aditivo/apostilamento "ressuscitar" contrato rescindido). Grava `toStatus` somente se o status
 * persistido ainda for `fromStatus` — na MESMA sentença SQL:
 *   UPDATE contract_workspaces SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status = ?
 * A decisão de SE a transição é permitida é da máquina de estados (`planInstrumentStatusChange` /
 * `canContractTransition`); aqui só se garante que ela vale para o estado REAL no instante da escrita.
 * Retorna `false` quando 0 linhas casam (status mudou em paralelo ou contrato inexistente no tenant).
 * O driver reporta linhas CASADAS (CLIENT_FOUND_ROWS), então `fromStatus === toStatus` também confirma.
 */
export async function compareAndSetContractWorkspaceStatus(params: {
  id: string; orgId: number; fromStatus: ContractStatus; toStatus: ContractStatus; updatedAt: string;
  /**
   * R9 / SEM-062 — designação de gestor/fiscal APLICADA pelo instrumento (apostilamento `gestor`/`fiscal`), na MESMA
   * sentença do CAS de status. Só as chaves presentes são gravadas; ausente ⇒ comportamento anterior (só status).
   */
  assignment?: { manager?: string; inspector?: string };
  /** Quando informado, o CAS também exige que a revisão (`updated_at`) persistida seja esta (lida sob o lock). */
  expectedUpdatedAt?: string;
}, executor?: ContractWsExecutor): Promise<boolean> {
  const db = executor ?? await getDb();
  if (!db) return false;
  const result = await db.update(contractWorkspacesTable)
    .set({
      status: params.toStatus, updatedAt: toDbDatetime(params.updatedAt),
      ...(params.assignment?.manager !== undefined ? { manager: params.assignment.manager } : {}),
      ...(params.assignment?.inspector !== undefined ? { inspector: params.assignment.inspector } : {}),
    })
    .where(and(
      eq(contractWorkspacesTable.id, params.id),
      eq(contractWorkspacesTable.organizationId, params.orgId),
      eq(contractWorkspacesTable.status, params.fromStatus),
      ...(params.expectedUpdatedAt ? [eq(contractWorkspacesTable.updatedAt, toDbDatetime(params.expectedUpdatedAt))] : []),
    ));
  const affected = (result[0] as { affectedRows?: number })?.affectedRows ?? 0;
  return affected > 0;
}

// ─── Generated documents (minutas) ────────────────────────────────────────────

export async function insertContractWsDocument(d: ContractGeneratedDocument): Promise<ContractGeneratedDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractWsDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, contractId: d.contractId, kind: d.kind, title: d.title,
    content: d.content, refId: d.refId, metadata: JSON.stringify(d.metadata), correlationId: d.correlationId, createdAt: toDbDatetime(d.createdAt),
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

/**
 * R9 / SEM-084 — próxima sequência de aditivo do contrato = MAX(sequence)+1 (não `count+1`: tolera lacunas). Só é
 * ATÔMICA quando chamada DENTRO da transação do instrumento, depois de `lockContractWorkspaceForInstrument` (a trava
 * da linha do contrato serializa os alocadores). Fora do lock é apenas uma leitura — nunca decide número.
 */
export async function nextAddendumSequenceUnderLock(contractId: string, orgId: number, tx: ContractWsExecutor): Promise<number> {
  const rows = await tx.select({ v: sql<number | string | null>`COALESCE(MAX(${contractAddendaTable.sequence}), 0)` }).from(contractAddendaTable)
    .where(and(eq(contractAddendaTable.contractId, contractId), eq(contractAddendaTable.organizationId, orgId)))
    .for("update"); // leitura corrente (nunca o snapshot REPEATABLE READ): vê o commit do alocador anterior
  return Number(rows[0]?.v ?? 0) + 1;
}

/**
 * Total de aditivos do tenant (todos os contratos da organização). Mesma fonte
 * canônica (`contract_addenda`) e mesmo escopo por `organization_id` de
 * `countContractAddenda` — apenas agregado no nível da organização, para KPIs
 * operacionais. Não introduz segunda fonte nem cópia auxiliar. Degrada sem DB.
 */
export async function countContractAddendaByOrg(orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: contractAddendaTable.id }).from(contractAddendaTable)
    .where(eq(contractAddendaTable.organizationId, orgId));
  return rows.length;
}

/**
 * Opções do writer de instrumento. `failOnDuplicate` (caminho governado SEM-025): INSERT puro — um id já
 * existente (mesma sequência calculada por duas criações concorrentes) falha com ER_DUP_ENTRY em vez de
 * fundir silenciosamente duas solicitações numa linha híbrida. Ausente ⇒ upsert legado (compatível).
 */
export interface InstrumentInsertOptions { readonly failOnDuplicate?: boolean }

export async function insertContractAddendum(a: ContractAddendum, executor?: ContractWsExecutor, opts: InstrumentInsertOptions = {}): Promise<ContractAddendum | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  const insert = db.insert(contractAddendaTable).values({
    id: a.id, organizationId: a.organizationId, contractId: a.contractId, addendumType: a.addendumType, sequence: a.sequence,
    justification: a.justification, newValue: String(a.newValue), newTerm: a.newTerm, status: a.status, requestOrigin: a.requestOrigin,
    documentReference: a.documentReference, legalOpinionRequestId: a.legalOpinionRequestId, correlationId: a.correlationId,
    createdAt: toDbDatetime(a.createdAt), updatedAt: toDbDatetime(a.updatedAt),
  });
  if (opts.failOnDuplicate) await insert;
  else await insert.onDuplicateKeyUpdate({ set: { status: a.status, justification: a.justification, documentReference: a.documentReference, legalOpinionRequestId: a.legalOpinionRequestId, updatedAt: toDbDatetime(a.updatedAt) } });
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

/**
 * SEM084-B — um aditivo pelo id, escopado por órgão E contrato (outro órgão/contrato ⇒ null). Usado para
 * reconhecer o instrumento já criado por uma tentativa anterior do MESMO comando (id derivado da chave de idempotência).
 */
export async function getContractAddendumById(id: string, contractId: string, orgId: number): Promise<ContractAddendum | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contractAddendaTable)
    .where(and(eq(contractAddendaTable.id, id), eq(contractAddendaTable.contractId, contractId), eq(contractAddendaTable.organizationId, orgId)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, organizationId: r.organizationId, contractId: r.contractId, addendumType: r.addendumType as ContractAddendum["addendumType"],
    sequence: r.sequence, justification: r.justification ?? "", newValue: Number(r.newValue), newTerm: r.newTerm,
    status: r.status as ContractAddendum["status"], requestOrigin: r.requestOrigin as ContractAddendum["requestOrigin"],
    documentReference: r.documentReference, legalOpinionRequestId: r.legalOpinionRequestId, correlationId: r.correlationId,
    createdAt: fromDbDatetime(String(r.createdAt)), updatedAt: fromDbDatetime(String(r.updatedAt)),
  };
}

// ─── Apostilles ──────────────────────────────────────────────────────────────

export async function countContractApostilles(contractId: string, orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: contractWsApostillesTable.id }).from(contractWsApostillesTable)
    .where(and(eq(contractWsApostillesTable.contractId, contractId), eq(contractWsApostillesTable.organizationId, orgId)));
  return rows.length;
}

/** R9 / SEM-084 — análogo a `nextAddendumSequenceUnderLock` para apostilamentos (mesmo contrato de uso: sob o lock). */
export async function nextApostilleSequenceUnderLock(contractId: string, orgId: number, tx: ContractWsExecutor): Promise<number> {
  const rows = await tx.select({ v: sql<number | string | null>`COALESCE(MAX(${contractWsApostillesTable.sequence}), 0)` }).from(contractWsApostillesTable)
    .where(and(eq(contractWsApostillesTable.contractId, contractId), eq(contractWsApostillesTable.organizationId, orgId)))
    .for("update");
  return Number(rows[0]?.v ?? 0) + 1;
}

export async function insertContractApostille(a: ContractApostille, executor?: ContractWsExecutor, opts: InstrumentInsertOptions = {}): Promise<ContractApostille | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  const insert = db.insert(contractWsApostillesTable).values({
    id: a.id, organizationId: a.organizationId, contractId: a.contractId, kind: a.kind, sequence: a.sequence,
    description: a.description, newValue: String(a.newValue), newManager: a.newManager, newInspector: a.newInspector,
    documentReference: a.documentReference, correlationId: a.correlationId, createdAt: toDbDatetime(a.createdAt),
  });
  if (opts.failOnDuplicate) await insert;
  else await insert.onDuplicateKeyUpdate({ set: { description: a.description, documentReference: a.documentReference } });
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

/** SEM084-B — um apostilamento pelo id, escopado por órgão E contrato (outro órgão/contrato ⇒ null). */
export async function getContractApostilleById(id: string, contractId: string, orgId: number): Promise<ContractApostille | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contractWsApostillesTable)
    .where(and(eq(contractWsApostillesTable.id, id), eq(contractWsApostillesTable.contractId, contractId), eq(contractWsApostillesTable.organizationId, orgId)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, organizationId: r.organizationId, contractId: r.contractId, kind: r.kind as ContractApostille["kind"], sequence: r.sequence,
    description: r.description ?? "", newValue: Number(r.newValue), newManager: r.newManager, newInspector: r.newInspector,
    documentReference: r.documentReference, correlationId: r.correlationId, createdAt: fromDbDatetime(String(r.createdAt)),
  };
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
