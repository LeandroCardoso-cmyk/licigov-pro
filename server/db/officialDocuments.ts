/**
 * RC-3 — Official Document Engine Persistence Repository
 *
 * Persiste os documentos oficiais (todas as versões, append-only por linhagem) e a
 * timeline documental. Padrão getDb(): degrada sem DB. Multi-tenant por tenant_id.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import { toDbDatetime } from "./institutionalConsultations";
import { officialDocumentsTable, officialDocumentTimelineTable } from "../../drizzle/schema";
import type { OfficialDocument, DocumentBusinessDomain, OfficialDocumentType, OfficialDocumentStatus } from "../domain/officialDocument";

// Conversão de data na FRONTEIRA DO BANCO (mesma convenção de db/procurement e das consultas
// institucionais): o domínio produz timestamps ISO (`new Date().toISOString()`, com `T`/`Z`) que
// colunas MySQL `DATETIME(3)` em MODO ESTRITO rejeitam ("Incorrect datetime value"). `toDb` normaliza
// na escrita. Sem isso, o INSERT do documento oficial falhava sob STRICT_TRANS_TABLES (staging/prod),
// derrubando a transação atômica da geração canônica (C.4A).
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;

// PR D — executor aceita a conexão (db) ou uma transação (tx), permitindo compor estas operações
// atomicamente (ver officialDocumentLifecycleService.createDocument). Quando ausente, usa getDb().
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type OfficialDocsExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

function rowToDoc(r: typeof officialDocumentsTable.$inferSelect): OfficialDocument {
  let metadata: Record<string, unknown> = {};
  try { metadata = r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : {}; } catch { metadata = {}; }
  return {
    id: r.id, tenantId: r.tenantId, businessDomain: r.businessDomain as DocumentBusinessDomain,
    documentType: r.documentType as OfficialDocumentType, origin: r.origin, title: r.title, version: r.version,
    status: r.status as OfficialDocumentStatus, template: r.template, content: r.content ?? "", metadata,
    author: r.author, lineageId: r.lineageId, correlationId: r.correlationId, replayHash: r.replayHash,
    storageKey: r.storageKey ?? "", mimeType: r.mimeType ?? "", size: r.size ?? 0, hash: r.hash ?? "",
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/**
 * NEW-016 — token estável da recusa por colisão de versão oficial. Uma versão oficial criada é
 * IMUTÁVEL: se o id determinístico (`odoc:tenant:lineage:version`) já existe, a escrita FALHA FECHADA
 * (nada é gravado) — nunca sobrescreve `content`/`status`/`metadata` de uma versão existente.
 */
export const OFFICIAL_DOCUMENT_VERSION_CONFLICT = "OFFICIAL_DOCUMENT_VERSION_CONFLICT";

/** Erro institucional estável de colisão (mapeado para CONFLICT no boundary tRPC). */
export class OfficialDocumentVersionConflictError extends TRPCError {
  constructor(what: string) {
    super({
      code: "CONFLICT",
      message: `${OFFICIAL_DOCUMENT_VERSION_CONFLICT}: ${what} já existe e é imutável — nenhuma escrita foi feita. Recarregue e tente novamente.`,
    });
    this.name = "OfficialDocumentVersionConflictError";
  }
}

/** ER_DUP_ENTRY (1062) do MySQL/MariaDB, inclusive encapsulado pelo driver/drizzle. Privado do módulo: o
 *  `db/index.ts` re-exporta `*` deste arquivo e outro repositório pode ter um helper homônimo (TS2308). */
function isDuplicateKeyError(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const x = e as { code?: string; errno?: number; cause?: unknown };
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
    e = x.cause;
  }
  return false;
}

/**
 * Insere uma NOVA versão oficial. INSERT PURO (append-only): sem upsert. Colisão de id (mesma
 * tenant/linhagem/versão) ⇒ `OfficialDocumentVersionConflictError` (CONFLICT), sem alterar a linha
 * existente. Sob InnoDB, um INSERT concorrente do mesmo id espera o commit do primeiro escritor e
 * então recebe ER_DUP_ENTRY — o conteúdo/status já gravado permanece intacto.
 */
export async function insertOfficialDocument(doc: OfficialDocument, executor?: OfficialDocsExecutor): Promise<OfficialDocument | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  try {
    await db.insert(officialDocumentsTable).values({
      id: doc.id, tenantId: doc.tenantId, businessDomain: doc.businessDomain, documentType: doc.documentType,
      origin: doc.origin, title: doc.title, version: doc.version, status: doc.status, template: doc.template,
      content: doc.content, metadata: JSON.stringify(doc.metadata), author: doc.author, lineageId: doc.lineageId,
      correlationId: doc.correlationId, replayHash: doc.replayHash,
      storageKey: doc.storageKey, mimeType: doc.mimeType, size: doc.size, hash: doc.hash,
      createdAt: toDb(doc.createdAt), updatedAt: toDb(doc.updatedAt),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new OfficialDocumentVersionConflictError(`A versão ${doc.version} desta linhagem documental`);
    throw err;
  }
  return doc;
}

/**
 * NEW-016 — maior versão da linhagem por LEITURA COM LOCK (`FOR UPDATE`, leitura corrente — não o
 * snapshot REPEATABLE READ da transação). Bloqueia até o commit de um escritor concorrente que já
 * inseriu uma versão na mesma linhagem e só então lê o valor commitado: a serialização da numeração
 * passa a valer ATÉ O COMMIT da transação (os row/gap locks do InnoDB só caem no commit/rollback),
 * inclusive quando a transação é EXTERNA e o GET_LOCK já foi liberado. Exige executor transacional.
 */
export async function lockLatestVersionForUpdate(lineageId: string, tenantId: number, tx: OfficialDocsExecutor): Promise<number> {
  const rows = await tx.select({ v: sql<number | string | null>`COALESCE(MAX(${officialDocumentsTable.version}), 0)` })
    .from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.tenantId, tenantId), eq(officialDocumentsTable.lineageId, lineageId)))
    .for("update");
  return Number(rows[0]?.v ?? 0);
}

/**
 * SEM-043 — `updateOfficialDocumentStorageRefs` REMOVIDA. Ela sobrescrevia `storage_key/mime_type/size_bytes/
 * content_hash` da linha da versão a cada export (DOCX apagava o ponteiro/hash do PDF da mesma versão). Os artefatos
 * agora são registrados no ledger append-only `official_document_artifacts` (ver `db/officialDocumentArtifacts.ts` e
 * `recordOfficialArtifact`). As colunas legadas permanecem na linha apenas como HISTÓRICO das versões exportadas antes
 * da 0315 (leitura via `rowToDoc` inalterada; nada mais as escreve — a linha da versão oficial é imutável).
 */

export async function getOfficialDocument(id: string, tenantId: number): Promise<OfficialDocument | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.id, id), eq(officialDocumentsTable.tenantId, tenantId))).limit(1);
  return rows.length ? rowToDoc(rows[0]) : null;
}

/** Última versão de uma linhagem (para versionamento incremental). */
export async function getLatestByLineage(lineageId: string, tenantId: number, executor?: OfficialDocsExecutor): Promise<OfficialDocument | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  const rows = await db.select().from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.lineageId, lineageId), eq(officialDocumentsTable.tenantId, tenantId)))
    .orderBy(desc(officialDocumentsTable.version)).limit(1);
  return rows.length ? rowToDoc(rows[0]) : null;
}

/**
 * R9 / SEM-039 — a ÚLTIMA versão `emitido` de um tipo documental de uma origem (processo), tenant-scoped. É a fonte
 * AUTORITATIVA que os documentos a jusante consomem (o snapshot `gerado` e o rascunho não são oficiais).
 */
export async function getLatestEmittedByOrigin(tenantId: number, businessDomain: string, origin: string, documentType: string): Promise<OfficialDocument | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(officialDocumentsTable)
    .where(and(
      eq(officialDocumentsTable.tenantId, tenantId), eq(officialDocumentsTable.businessDomain, businessDomain),
      eq(officialDocumentsTable.origin, origin), eq(officialDocumentsTable.documentType, documentType),
      eq(officialDocumentsTable.status, "emitido"),
    ))
    .orderBy(desc(officialDocumentsTable.version)).limit(1);
  return rows.length ? rowToDoc(rows[0]) : null;
}

export async function countVersions(lineageId: string, tenantId: number, executor?: OfficialDocsExecutor): Promise<number> {
  const db = executor ?? await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: officialDocumentsTable.id }).from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.lineageId, lineageId), eq(officialDocumentsTable.tenantId, tenantId)));
  return rows.length;
}

export async function listVersions(lineageId: string, tenantId: number): Promise<Array<{ id: string; version: number; status: string; replayHash: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.lineageId, lineageId), eq(officialDocumentsTable.tenantId, tenantId)))
    .orderBy(asc(officialDocumentsTable.version));
  return rows.map(r => ({ id: r.id, version: r.version, status: r.status, replayHash: r.replayHash, createdAt: r.createdAt }));
}

export async function listOfficialDocuments(tenantId: number, opts: { businessDomain?: string; origin?: string; limit?: number } = {}): Promise<Array<{ id: string; businessDomain: string; documentType: string; origin: string; title: string; version: number; status: string; lineageId: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(officialDocumentsTable)
    .where(eq(officialDocumentsTable.tenantId, tenantId)).orderBy(desc(officialDocumentsTable.updatedAt)).limit(opts.limit ?? 100);
  let mapped = rows.map(r => ({ id: r.id, businessDomain: r.businessDomain, documentType: r.documentType, origin: r.origin, title: r.title, version: r.version, status: r.status, lineageId: r.lineageId, createdAt: r.createdAt }));
  if (opts.businessDomain) mapped = mapped.filter(d => d.businessDomain === opts.businessDomain);
  if (opts.origin) mapped = mapped.filter(d => d.origin === opts.origin);
  return mapped;
}

// ─── Timeline documental (append-only) ────────────────────────────────────────

/**
 * Posição do próximo evento da timeline da linhagem. `opts.forUpdate` (NEW-016) usa leitura CORRENTE
 * com lock (`FOR UPDATE`) — obrigatório dentro da transação que cria uma versão oficial, cujo snapshot
 * REPEATABLE READ pode ser anterior ao commit de um escritor concorrente (ordem duplicada).
 */
export async function countDocumentTimeline(lineageId: string, tenantId: number, executor?: OfficialDocsExecutor, opts: { forUpdate?: boolean } = {}): Promise<number> {
  const db = executor ?? await getDb();
  if (!db) return 0;
  const q = db.select({ id: officialDocumentTimelineTable.id }).from(officialDocumentTimelineTable)
    .where(and(eq(officialDocumentTimelineTable.lineageId, lineageId), eq(officialDocumentTimelineTable.tenantId, tenantId)));
  const rows = opts.forUpdate ? await q.for("update") : await q;
  return rows.length;
}

/**
 * Registra um evento na timeline documental. `opts.insertOnly` (NEW-016) = INSERT PURO: colisão de id
 * ⇒ `OfficialDocumentVersionConflictError`, nunca reescrita do `summary` de um evento já registrado
 * (a timeline não pode falsificar um overwrite). Sem a opção, preserva o comportamento anterior
 * (upsert de `summary`). SEM-043: o evento de exportação (`documento_exportado`) agora também é `insertOnly` (na
 * transação do ledger de artefatos) — nenhum chamador usa mais o ramo de upsert (remoção: follow-up, NEW-004 #8).
 */
export async function insertDocumentTimelineEntry(params: { tenantId: number; lineageId: string; documentId: string; order: number; eventType: string; actor: string; summary: string; correlationId: string }, executor?: OfficialDocsExecutor, opts: { insertOnly?: boolean } = {}): Promise<void> {
  const db = executor ?? await getDb();
  if (!db) return;
  const id = createHash("sha256").update(`odtl:${params.tenantId}:${params.lineageId}:${params.order}:${params.eventType}`).digest("hex").slice(0, 20);
  const values = {
    id, tenantId: params.tenantId, lineageId: params.lineageId, documentId: params.documentId, eventOrder: params.order,
    eventType: params.eventType, actor: params.actor, summary: params.summary, correlationId: params.correlationId,
  };
  if (!opts.insertOnly) {
    await db.insert(officialDocumentTimelineTable).values(values).onDuplicateKeyUpdate({ set: { summary: params.summary } });
    return;
  }
  try {
    await db.insert(officialDocumentTimelineTable).values(values);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new OfficialDocumentVersionConflictError(`O evento ${params.order} da timeline documental`);
    throw err;
  }
}

export async function listDocumentTimeline(lineageId: string, tenantId: number): Promise<Array<{ id: string; order: number; eventType: string; actor: string; summary: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(officialDocumentTimelineTable)
    .where(and(eq(officialDocumentTimelineTable.lineageId, lineageId), eq(officialDocumentTimelineTable.tenantId, tenantId)))
    .orderBy(asc(officialDocumentTimelineTable.eventOrder));
  return rows.map(r => ({ id: r.id, order: r.eventOrder, eventType: r.eventType, actor: r.actor, summary: r.summary ?? "", createdAt: r.createdAt }));
}
