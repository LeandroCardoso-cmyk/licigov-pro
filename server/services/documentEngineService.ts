/**
 * RC-3 — Document Engine (serviço oficial do Cognitive Kernel)
 *
 * Pipeline ÚNICO de todos os documentos oficiais do LiciGov Pro. Nenhum Business
 * Domain gera documento diretamente: cada domínio apenas informa dados/conteúdo/tipo,
 * e o Document Engine cuida de template → versionamento → timeline → exportação
 * (DOCX/PDF reais). Todo acesso ao Kernel via kernelAccessService. Determinístico,
 * replay-safe, multi-tenant. Degrada graciosamente sem DB.
 *
 * Pipeline: Business Domain → OfficialDocument → template → versão → timeline → export.
 */

import { assertKernelAccess } from "./kernelAccessService";
import { convertToDOCX, convertToPDF } from "./documentConverter";
import {
  createOfficialDocument, computeLineageId, officialFilename, OFFICIAL_MIME_TYPES,
  type OfficialDocument, type DocumentBusinessDomain, type OfficialDocumentType, type OfficialFormat,
} from "../domain/officialDocument";
import {
  insertOfficialDocument, getOfficialDocument, getLatestByLineage, countVersions,
  listVersions, listOfficialDocuments, countDocumentTimeline, insertDocumentTimelineEntry, listDocumentTimeline,
  updateOfficialDocumentStorageRefs,
} from "../db/officialDocuments";
// RC-3.5 — o Document Engine NUNCA conhece o Amazon S3: fala apenas com o Storage Service.
import { isStorageConfigured, storagePut, storageSignedUrl } from "../storage";
import { createHash } from "crypto";

async function recordDocEvent(doc: OfficialDocument, eventType: string, summary: string): Promise<void> {
  const order = await countDocumentTimeline(doc.lineageId, doc.tenantId);
  await insertDocumentTimelineEntry({
    tenantId: doc.tenantId, lineageId: doc.lineageId, documentId: doc.id, order,
    eventType, actor: doc.author, summary, correlationId: doc.correlationId,
  });
}

export interface GenerateOfficialDocumentParams {
  organizationId: number;
  businessDomain: DocumentBusinessDomain;
  documentType: OfficialDocumentType;
  origin: string;
  title: string;
  /** Conteúdo em Markdown (representação intermediária). O engine exporta DOCX/PDF. */
  content: string;
  metadata?: Record<string, unknown>;
  author: string;
  status?: OfficialDocument["status"];
  correlationId: string;
}

/**
 * Gera (ou versiona) um documento oficial pelo pipeline único. Nunca sobrescreve:
 * cada chamada cria uma NOVA versão na mesma linhagem. Registra timeline append-only.
 */
export async function generateOfficialDocument(params: GenerateOfficialDocumentParams): Promise<OfficialDocument> {
  // Acesso ao Kernel exclusivamente pela porta oficial (Document Engine).
  assertKernelAccess(params.businessDomain, "document_engine");

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

export interface RenderedOfficialDocument {
  readonly documentId: string;
  readonly format: OfficialFormat;
  readonly filename: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly mimeType: string;
  /** Chave do objeto no Storage Service (S3), quando o storage está configurado. */
  readonly storageKey?: string;
  /** URL de download assinada (S3), quando o storage está configurado. */
  readonly downloadUrl?: string;
  /** Binário em base64 — fallback quando o Storage Service NÃO está configurado. */
  readonly base64?: string;
}

/**
 * Exporta um documento oficial em DOCX ou PDF (binário real). Fluxo oficial:
 * Document Engine → OfficialDocument → Storage Service → Amazon S3 → URL assinada.
 * O Document Engine não conhece o S3 — usa apenas o Storage Service. Quando o storage
 * não está configurado, degrada para base64 (nunca binário no banco). Registra timeline.
 */
export async function renderOfficialDocument(params: { organizationId: number; documentId: string; format: OfficialFormat }): Promise<RenderedOfficialDocument> {
  const doc = await getOfficialDocument(params.documentId, params.organizationId);
  if (!doc) throw new Error("Documento oficial não encontrado.");
  assertKernelAccess(doc.businessDomain, "document_engine");

  const filename = officialFilename(doc, params.format);
  const mimeType = OFFICIAL_MIME_TYPES[params.format];
  const buffer = params.format === "docx"
    ? await convertToDOCX(doc.content, filename)
    : await convertToPDF(doc.content, filename);
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const base: RenderedOfficialDocument = {
    documentId: doc.id, format: params.format, filename, contentHash, bytes: buffer.length, mimeType,
  };

  if (isStorageConfigured()) {
    // Chave organizada por: document-engine/{tenantId}/{lineage}/{documentId}-{filename}
    const storageKey = `document-engine/${doc.tenantId}/${doc.lineageId}/${doc.id}-${filename}`;
    await storagePut(storageKey, buffer, mimeType);
    const { url } = await storageSignedUrl(storageKey);
    await updateOfficialDocumentStorageRefs({
      id: doc.id, tenantId: doc.tenantId, storageKey, mimeType, size: buffer.length, hash: contentHash,
    });
    await recordDocEvent(doc, "documento_exportado", `Documento "${doc.title}" exportado em ${params.format.toUpperCase()} e persistido no Storage Service (S3).`);
    return { ...base, storageKey, downloadUrl: url };
  }

  // Fallback (storage não configurado): entrega base64, sem binário em banco.
  await recordDocEvent(doc, "documento_exportado", `Documento "${doc.title}" exportado em ${params.format.toUpperCase()}.`);
  return { ...base, base64: buffer.toString("base64") };
}

/** Prévia (conteúdo Markdown) do documento oficial — sem gerar binário. */
export async function previewOfficialDocument(params: { organizationId: number; documentId: string }): Promise<{ document: OfficialDocument | null }> {
  const document = await getOfficialDocument(params.documentId, params.organizationId);
  return { document };
}

export { getOfficialDocument, listOfficialDocuments, listVersions, listDocumentTimeline, computeLineageId };
