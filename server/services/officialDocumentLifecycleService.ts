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

import { createHash } from "crypto";
import {
  createOfficialDocument, computeLineageId, officialFilename, OFFICIAL_MIME_TYPES,
  type OfficialDocument, type DocumentBusinessDomain, type OfficialDocumentType, type OfficialFormat,
} from "../domain/officialDocument";
import {
  insertOfficialDocument, getLatestByLineage, countVersions,
  countDocumentTimeline, insertDocumentTimelineEntry, updateOfficialDocumentStorageRefs,
} from "../db/officialDocuments";
// Único consumidor do Storage Service no fluxo documental (Document Engine nunca toca no S3).
import { isStorageConfigured, storageFallbackAllowed, assertStorageUsable, storagePut, storageSignedUrl } from "../storage";

// ─── Timeline (append-only) — responsabilidade do Lifecycle ───────────────────

async function recordDocEvent(doc: OfficialDocument, eventType: string, summary: string): Promise<void> {
  const order = await countDocumentTimeline(doc.lineageId, doc.tenantId);
  await insertDocumentTimelineEntry({
    tenantId: doc.tenantId, lineageId: doc.lineageId, documentId: doc.id, order,
    eventType, actor: doc.author, summary, correlationId: doc.correlationId,
  });
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
export async function createDocument(params: CreateDocumentParams): Promise<OfficialDocument> {
  const lineageId = computeLineageId({ tenantId: params.organizationId, businessDomain: params.businessDomain, documentType: params.documentType, origin: params.origin });
  const previous = await getLatestByLineage(lineageId, params.organizationId);
  const version = ((await countVersions(lineageId, params.organizationId)) || (previous ? previous.version : 0)) + 1;

  const doc = createOfficialDocument({
    tenantId: params.organizationId, businessDomain: params.businessDomain, documentType: params.documentType,
    origin: params.origin, title: params.title, content: params.content, version, metadata: params.metadata,
    author: params.author, status: params.status, correlationId: params.correlationId,
  });
  await insertOfficialDocument(doc);
  await recordDocEvent(doc, version === 1 ? "documento_criado" : "nova_versao", `${version === 1 ? "Documento" : `Versão ${version} do documento`} "${doc.title}" (${doc.documentType}) gerado(a) pelo Document Engine.`);
  return doc;
}

// ─── Armazenamento do artefato renderizado ────────────────────────────────────

export interface StoredArtifact {
  readonly documentId: string;
  readonly format: OfficialFormat;
  readonly filename: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly mimeType: string;
  /** Chave do objeto no Storage Service (S3), quando armazenado. */
  readonly storageKey?: string;
  /** URL de download assinada (S3), quando armazenado. */
  readonly downloadUrl?: string;
  /** Binário em base64 — SOMENTE em desenvolvimento/testes (nunca em produção). */
  readonly base64?: string;
}

/**
 * Recebe o artefato JÁ gerado pelo Document Engine (buffer) e cumpre o restante do
 * ciclo de vida: calcula hash → aplica a Storage Policy → (upload + Signed URL via
 * Storage Service) → persiste as referências no OfficialDocument → registra timeline.
 * Nunca armazena binário no banco. Em produção sem storage, FALHA explicitamente.
 */
export async function storeRenderedArtifact(params: { doc: OfficialDocument; format: OfficialFormat; buffer: Buffer }): Promise<StoredArtifact> {
  const { doc, format, buffer } = params;
  const filename = officialFilename(doc, format);
  const mimeType = OFFICIAL_MIME_TYPES[format];
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const base: StoredArtifact = { documentId: doc.id, format, filename, contentHash, bytes: buffer.length, mimeType };

  // Storage Policy decide (dentro do Storage Service): produção exige storage.
  assertStorageUsable();

  if (isStorageConfigured()) {
    const storageKey = `document-engine/${doc.tenantId}/${doc.lineageId}/${doc.id}-${filename}`;
    await storagePut(storageKey, buffer, mimeType);
    const { url } = await storageSignedUrl(storageKey);
    await updateOfficialDocumentStorageRefs({ id: doc.id, tenantId: doc.tenantId, storageKey, mimeType, size: buffer.length, hash: contentHash });
    await recordDocEvent(doc, "documento_exportado", `Documento "${doc.title}" exportado em ${format.toUpperCase()} e persistido no Storage Service (S3).`);
    return { ...base, storageKey, downloadUrl: url };
  }

  // Somente desenvolvimento/testes: fallback Base64 (garantido por storageFallbackAllowed via assertStorageUsable).
  await recordDocEvent(doc, "documento_exportado", `Documento "${doc.title}" exportado em ${format.toUpperCase()} (base64 — ambiente de desenvolvimento).`);
  return { ...base, base64: buffer.toString("base64") };
}

export { storageFallbackAllowed };
