/**
 * RC-3.5.1 — OfficialDocumentLifecycleService (componente PERMANENTE do Cognitive Kernel).
 *
 * Responsabilidade EXCLUSIVA: o ciclo de vida do documento oficial.
 *
 *   receber documento → versionar → registrar timeline → calcular hash →
 *   persistir metadados → utilizar Storage Service → armazenar StorageKey →
 *   gerar Signed URL → devolver OfficialDocument
 *
 * O Document Engine NÃO versiona, NÃO registra timeline, NÃO faz upload, NÃO acessa
 * Storage e NÃO conhece o Amazon S3 — tudo isso pertence a este serviço. Este serviço
 * é o ÚNICO consumidor do Storage Service no fluxo documental. Determinístico,
 * replay-safe, multi-tenant. Degrada graciosamente sem DB.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import {
  createOfficialDocument, computeLineageId, officialFilename, OFFICIAL_MIME_TYPES,
  type OfficialDocument, type DocumentBusinessDomain, type OfficialDocumentType, type OfficialFormat,
} from "../domain/officialDocument";
import {
  insertOfficialDocument, getLatestByLineage, countVersions, lockLatestVersionForUpdate,
  countDocumentTimeline, insertDocumentTimelineEntry,
  type OfficialDocsExecutor,
} from "../db/officialDocuments";
import {
  insertOfficialDocumentArtifact, sha256Hex, type OfficialDocumentArtifact,
} from "../db/officialDocumentArtifacts";
// Único consumidor do Storage Service no fluxo documental (Document Engine nunca toca no S3).
import { isStorageConfigured, storageFallbackAllowed, assertStorageUsable, storagePut, storageSignedUrl } from "../storage";

// ─── Timeline (append-only) — responsabilidade do Lifecycle ───────────────────

async function recordDocEvent(
  doc: OfficialDocument, eventType: string, summary: string, executor?: OfficialDocsExecutor,
  opts: { locked?: boolean } = {},
): Promise<void> {
  // `locked` (NEW-016): dentro da transação da versão — ordem por leitura corrente com lock e INSERT
  // puro (colisão ⇒ CONFLICT; nunca reescreve um evento já registrado).
  const order = await countDocumentTimeline(doc.lineageId, doc.tenantId, executor, { forUpdate: opts.locked });
  await insertDocumentTimelineEntry({
    tenantId: doc.tenantId, lineageId: doc.lineageId, documentId: doc.id, order,
    eventType, actor: doc.author, summary, correlationId: doc.correlationId,
  }, executor, { insertOnly: opts.locked });
}

/**
 * NEW-016 — token estável quando o lock nomeado da linhagem não pôde ser obtido (timeout, erro ou
 * NULL). A criação da versão FALHA FECHADA: nada é lido/escrito sem o lock.
 */
export const OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE = "OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE";
const LINEAGE_LOCK_TIMEOUT_SECONDS = 10;

/** Resultado de `SELECT GET_LOCK(...) AS ok` via drizzle/mysql2 (`[rows, fields]` ou `rows`). */
function readLockResult(res: unknown): number | null {
  const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res) as Array<{ ok?: unknown }> | undefined;
  const v = Array.isArray(rows) ? rows[0]?.ok : undefined;
  return v === null || v === undefined ? null : Number(v);
}

// ─── Criação/versionamento + persistência de metadados ────────────────────────

export interface CreateDocumentParams {
  organizationId: number;
  businessDomain: DocumentBusinessDomain;
  documentType: OfficialDocumentType;
  origin: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  author: string;
  status?: OfficialDocument["status"];
  correlationId: string;
}

/**
 * Cria (ou versiona) um documento oficial. Nunca sobrescreve: cada chamada cria uma
 * NOVA versão na mesma linhagem. Calcula hash (replayHash), persiste metadados e
 * registra a timeline. Não gera binário nem toca no Storage.
 */
export async function createDocument(params: CreateDocumentParams, executor?: OfficialDocsExecutor): Promise<OfficialDocument> {
  const lineageId = computeLineageId({ tenantId: params.organizationId, businessDomain: params.businessDomain, documentType: params.documentType, origin: params.origin });

  const makeDoc = (version: number): OfficialDocument => createOfficialDocument({
    tenantId: params.organizationId, businessDomain: params.businessDomain, documentType: params.documentType,
    origin: params.origin, title: params.title, content: params.content, version, metadata: params.metadata,
    author: params.author, status: params.status, correlationId: params.correlationId,
  });
  // C.4B.1 — evento sensível ao status: uma versão "emitido" é uma EMISSÃO oficial governada,
  // não um snapshot técnico "gerado". A distinção fica fiel na timeline documental (append-only).
  const eventTypeFor = (doc: OfficialDocument, version: number) =>
    doc.status === "emitido" ? "documento_emitido" : (version === 1 ? "documento_criado" : "nova_versao");
  const summaryFor = (doc: OfficialDocument, version: number) =>
    doc.status === "emitido"
      ? `Versão ${version} do documento "${doc.title}" (${doc.documentType}) EMITIDA (oficial) pelo Document Engine.`
      : `${version === 1 ? "Documento" : `Versão ${version} do documento`} "${doc.title}" (${doc.documentType}) gerado(a) pelo Document Engine.`;

  const db = await getDb();

  // Degradação graciosa sem DB (comportamento anterior preservado): computa e devolve sem persistir.
  if (!db && !executor) {
    const previous = await getLatestByLineage(lineageId, params.organizationId);
    const version = ((await countVersions(lineageId, params.organizationId)) || (previous ? previous.version : 0)) + 1;
    return makeDoc(version);
  }

  // PR D / DATA-012 — ATOMICIDADE: cálculo de versão + inserção do documento oficial + evento de
  // timeline. A numeração é serializada por linhagem com um lock nomeado (GET_LOCK) — evita colisão de
  // versão e perda silenciosa de evento por corrida, INCLUSIVE na 1ª versão. O lock é liberado sempre
  // (finally), pois locks nomeados não são desfeitos por rollback.
  //
  // NEW-016 — o GET_LOCK é liberado ANTES do commit da transação (externa ou própria); sozinho ele NÃO
  // serializa até o commit. Por isso, dentro do lock:
  //   1. o retorno do GET_LOCK é verificado (≠ 1 ⇒ FALHA FECHADA, sem ler/escrever);
  //   2. a maior versão é lida com `FOR UPDATE` (leitura corrente): um escritor concorrente cuja
  //      versão ainda não commitou BLOQUEIA esta leitura até o commit — a serialização passa a valer
  //      até o COMMIT, também com transação externa e snapshot REPEATABLE READ antigo;
  //   3. a nova versão e o evento de timeline são INSERT PURO — qualquer colisão residual vira
  //      CONFLICT (`OFFICIAL_DOCUMENT_VERSION_CONFLICT`), nunca sobrescrita. Uma versão oficial
  //      criada (em especial `emitido`) é IMUTÁVEL: erro é preferível a corrupção.
  const lockKey = `odoc:${params.organizationId}:${lineageId}`.slice(0, 60);
  // C.4A — o corpo roda sobre o executor recebido (transação EXTERNA compartilhada com a persistência
  // do generated_document + idempotency) ou, quando ausente, numa transação PRÓPRIA. GET_LOCK exige a
  // MESMA conexão do início ao fim: por isso o caso sem executor abre a própria tx (nunca a pool crua).
  const persist = async (tx: OfficialDocsExecutor): Promise<OfficialDocument> => {
    const acquired = readLockResult(await tx.execute(sql`SELECT GET_LOCK(${lockKey}, ${LINEAGE_LOCK_TIMEOUT_SECONDS}) AS ok`));
    if (acquired !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `${OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE}: a linhagem documental está ocupada por outra operação — nenhuma versão foi criada. Tente novamente.`,
      });
    }
    try {
      const version = (await lockLatestVersionForUpdate(lineageId, params.organizationId, tx)) + 1;
      const doc = makeDoc(version);
      await insertOfficialDocument(doc, tx);
      await recordDocEvent(doc, eventTypeFor(doc, version), summaryFor(doc, version), tx, { locked: true });
      return doc;
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${lockKey})`);
    }
  };

  if (executor) return persist(executor);        // transação externa (commit atômico do chamador)
  return db!.transaction(async (tx) => persist(tx)); // transação própria (comportamento anterior)
}

// ─── Armazenamento do artefato renderizado ────────────────────────────────────

export interface StoredArtifact {
  readonly documentId: string;
  readonly format: OfficialFormat;
  readonly filename: string;
  /** sha256 dos bytes do artefato (alias de `artifactHash`, mantido para os consumidores existentes). */
  readonly contentHash: string;
  /** SEM-043 — sha256 dos bytes renderizados, registrado no ledger `official_document_artifacts`. */
  readonly artifactHash: string;
  /** Id da linha do ledger (ausente sem DB — desenvolvimento). */
  readonly artifactId?: string;
  /** true = esta chamada ANEXOU a linha; false = bytes idênticos já registrados (no-op idempotente). */
  readonly artifactRecorded?: boolean;
  readonly bytes: number;
  readonly mimeType: string;
  /** Chave do objeto no Storage Service (S3), quando armazenado. */
  readonly storageKey?: string;
  /** URL de download assinada (S3), quando armazenado. */
  readonly downloadUrl?: string;
  /** Binário em base64 — SOMENTE em desenvolvimento/testes (nunca em produção). */
  readonly base64?: string;
}

/** Ator humano do artefato: `user:<id>` — nunca um agente (multi_copilot) nem id inválido. */
function humanArtifactActor(actorUserId: number): string {
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "OFFICIAL_ARTIFACT_ACTOR_REQUIRED: o export oficial exige o usuário humano autenticado." });
  }
  return `user:${actorUserId}`;
}

/**
 * SEM-043 — Registra o artefato renderizado no LEDGER append-only `official_document_artifacts` e, se a linha
 * for NOVA, o evento `documento_exportado` da timeline (formato + hash do artefato; um id por evento) — AMBOS
 * na mesma transação, serializada pelo lock nomeado da linhagem (mesmo `odoc:` da criação de versão). O upload
 * ao S3 já ocorreu ANTES, fora de qualquer transação/lock: aqui só persistência determinística.
 *
 *  - bytes idênticos (mesmo documento+formato) ⇒ no-op idempotente: devolve a linha existente, sem evento novo;
 *  - bytes diferentes no mesmo formato, ou outro formato ⇒ NOVA linha (nunca sobrescreve a anterior);
 *  - falha de lock/ledger ⇒ FALHA FECHADA (o export não devolve URL sem a prova registrada);
 *  - sem DB (desenvolvimento) ⇒ `artifact: null`, sem escrita.
 */
export async function recordOfficialArtifact(params: {
  doc: OfficialDocument; format: OfficialFormat; artifactHash: string; sizeBytes: number; mimeType: string;
  storageKey?: string; identityFingerprint?: string; actorUserId: number; correlationId?: string;
}): Promise<{ artifact: OfficialDocumentArtifact | null; created: boolean }> {
  const { doc, format } = params;
  const actor = humanArtifactActor(params.actorUserId);
  const db = await getDb();
  if (!db) return { artifact: null, created: false };

  const correlationId = params.correlationId ?? "";
  const lockKey = `odoc:${doc.tenantId}:${doc.lineageId}`.slice(0, 60);
  return db.transaction(async (tx) => {
    const acquired = readLockResult(await tx.execute(sql`SELECT GET_LOCK(${lockKey}, ${LINEAGE_LOCK_TIMEOUT_SECONDS}) AS ok`));
    if (acquired !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `${OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE}: a linhagem documental está ocupada por outra operação — o artefato não foi registrado. Tente novamente.`,
      });
    }
    try {
      const res = await insertOfficialDocumentArtifact({
        tenantId: doc.tenantId, documentId: doc.id, lineageId: doc.lineageId, version: doc.version, format,
        artifactHash: params.artifactHash, sizeBytes: params.sizeBytes, mimeType: params.mimeType,
        storageKey: params.storageKey ?? "", sourceContentHash: sha256Hex(doc.content), sourceReplayHash: doc.replayHash,
        identityFingerprint: params.identityFingerprint ?? "", correlationId, createdBy: actor,
      }, tx);
      if (!res) return { artifact: null, created: false };
      if (res.created) {
        const order = await countDocumentTimeline(doc.lineageId, doc.tenantId, tx, { forUpdate: true });
        const where = params.storageKey ? "persistido no Storage Service (S3)" : "base64 — ambiente de desenvolvimento";
        await insertDocumentTimelineEntry({
          tenantId: doc.tenantId, lineageId: doc.lineageId, documentId: doc.id, order,
          eventType: "documento_exportado", actor, correlationId,
          summary: `Documento "${doc.title}" (v${doc.version}) exportado em ${format.toUpperCase()}; hash do artefato sha256:${params.artifactHash}; ${where}.`,
        }, tx, { insertOnly: true });
      }
      return res;
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${lockKey})`);
    }
  });
}

/**
 * Recebe o artefato JÁ gerado pelo Document Engine (buffer) e cumpre o restante do
 * ciclo de vida: calcula hash → aplica a Storage Policy → (upload + Signed URL via
 * Storage Service) → registra o artefato no ledger append-only (SEM-043) + timeline.
 * Nunca armazena binário no banco. Em produção sem storage, FALHA explicitamente.
 *
 * SEM-043 — NÃO escreve mais as colunas `storage_key/mime_type/size_bytes/content_hash` da linha da versão (eram
 * sobrescritas a cada export: DOCX apagava o ponteiro/hash do PDF). A chave do objeto S3 é endereçada pelo hash:
 * bytes diferentes nunca sobrescrevem um objeto já registrado; bytes idênticos reescrevem o mesmo objeto (idempotente).
 */
export async function storeRenderedArtifact(params: {
  doc: OfficialDocument; format: OfficialFormat; buffer: Buffer; actorUserId: number; correlationId?: string;
}): Promise<StoredArtifact> {
  const { doc, format, buffer } = params;
  const filename = officialFilename(doc, format);
  const mimeType = OFFICIAL_MIME_TYPES[format];
  const artifactHash = sha256Hex(buffer);

  const base = { documentId: doc.id, format, filename, contentHash: artifactHash, artifactHash, bytes: buffer.length, mimeType };

  // Storage Policy decide (dentro do Storage Service): produção exige storage.
  assertStorageUsable();

  if (isStorageConfigured()) {
    const storageKey = `document-engine/${doc.tenantId}/${doc.lineageId}/${doc.id}-${artifactHash.slice(0, 16)}-${filename}`;
    await storagePut(storageKey, buffer, mimeType);
    const { url } = await storageSignedUrl(storageKey);
    const rec = await recordOfficialArtifact({
      doc, format, artifactHash, sizeBytes: buffer.length, mimeType, storageKey,
      actorUserId: params.actorUserId, correlationId: params.correlationId,
    });
    return { ...base, storageKey, downloadUrl: url, artifactId: rec.artifact?.id, artifactRecorded: rec.created };
  }

  // Somente desenvolvimento/testes: fallback Base64 (garantido por storageFallbackAllowed via assertStorageUsable).
  const rec = await recordOfficialArtifact({
    doc, format, artifactHash, sizeBytes: buffer.length, mimeType,
    actorUserId: params.actorUserId, correlationId: params.correlationId,
  });
  return { ...base, base64: buffer.toString("base64"), artifactId: rec.artifact?.id, artifactRecorded: rec.created };
}

export { storageFallbackAllowed };
