/**
 * RC-3.5.1 — Document Engine (serviço oficial do Cognitive Kernel).
 *
 * Porta de entrada dos Business Domains para o pipeline documental. Sua ÚNICA
 * responsabilidade é GERAR DOCUMENTOS: receber conteúdo → converter → renderizar →
 * retornar artefato. Todo o CICLO DE VIDA (versionar, timeline, hash, persistir
 * metadados, Storage, Signed URL) pertence ao OfficialDocumentLifecycleService.
 *
 * O Document Engine NÃO versiona, NÃO registra timeline, NÃO faz upload, NÃO acessa
 * o Storage e NÃO conhece o Amazon S3.
 *
 * Fluxo oficial:
 *   Business Domain → Document Engine → OfficialDocumentLifecycleService →
 *   Storage Service → Amazon S3 → Signed URL → OfficialDocument
 */

import { assertKernelAccess } from "./kernelAccessService";
// Motor de conversão (ENGINE OFICIAL) — produz o artefato binário (DOCX/PDF).
import {
  convertToDOCX, convertToPDF,
  buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF,
  type InstitutionalMeta,
} from "./documentConverter";
// Ciclo de vida documental (versão, timeline, hash, storage, signed URL).
import { createDocument, storeRenderedArtifact, type StoredArtifact } from "./officialDocumentLifecycleService";
import {
  officialFilename,
  type OfficialDocument, type DocumentBusinessDomain, type OfficialDocumentType, type OfficialFormat,
} from "../domain/officialDocument";
import {
  getOfficialDocument, listVersions, listOfficialDocuments, listDocumentTimeline,
} from "../db/officialDocuments";
import { computeLineageId } from "../domain/officialDocument";

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
 * Gera (ou versiona) um documento oficial. O Document Engine valida o acesso ao
 * Kernel e delega TODO o ciclo de vida (versão/timeline/hash/persistência) ao
 * OfficialDocumentLifecycleService.
 */
export async function generateOfficialDocument(params: GenerateOfficialDocumentParams): Promise<OfficialDocument> {
  assertKernelAccess(params.businessDomain, "document_engine");
  return createDocument(params);
}

/** Artefato renderizado devolvido pelo Document Engine (metadados de storage vindos do Lifecycle). */
export type RenderedOfficialDocument = StoredArtifact;

/**
 * Exporta um documento oficial em DOCX ou PDF. O Document Engine apenas CONVERTE
 * (gera o artefato binário) e entrega o buffer ao OfficialDocumentLifecycleService,
 * que cuida de hash + Storage Service + Signed URL + persistência. O Document Engine
 * jamais toca no Storage/S3.
 */
export async function renderOfficialDocument(params: { organizationId: number; documentId: string; format: OfficialFormat }): Promise<RenderedOfficialDocument> {
  const doc = await getOfficialDocument(params.documentId, params.organizationId);
  if (!doc) throw new Error("Documento oficial não encontrado.");
  assertKernelAccess(doc.businessDomain, "document_engine");

  // Document Engine: gerar/converter/renderizar → artefato (buffer). Nada além disso.
  const filename = officialFilename(doc, params.format);
  const buffer = params.format === "docx"
    ? await convertToDOCX(doc.content, filename)
    : await convertToPDF(doc.content, filename);

  // Ciclo de vida (hash, Storage, Signed URL, persistência) é do Lifecycle Service.
  return storeRenderedArtifact({ doc, format: params.format, buffer });
}

/**
 * Renderiza um CONTEÚDO arbitrário (Markdown/representação intermediária) para o
 * artefato binário (DOCX/PDF). Primitiva genérica do Document Engine, reutilizada
 * pelo pipeline COMUM de exportação (`documentExportService`). Mantém a fronteira
 * RC-3.5.2: o Document Engine é o ÚNICO a acionar o DocumentConverter. NÃO toca no
 * Storage/S3 — isso é responsabilidade do chamador.
 */
export async function renderContent(params: {
  content: string;
  fileName: string;
  format: OfficialFormat;
  header?: { organizationName?: string; address?: string; cnpj?: string; phone?: string; email?: string; website?: string };
}): Promise<Buffer> {
  const h = params.header ?? {};
  return params.format === "docx"
    ? convertToDOCX(params.content, params.fileName, h.organizationName, h.address, h.cnpj, h.phone, h.email, h.website)
    : convertToPDF(params.content, params.fileName, h.organizationName, h.address, h.cnpj, h.phone, h.email, h.website);
}

/**
 * Renderiza um documento com ACABAMENTO INSTITUCIONAL (cabeçalho: organização,
 * processo, objeto, status, versão, data; destaque de RASCUNHO; corpo Markdown
 * interpretado via `marked`, sem artefatos) para DOCX/PDF, a partir de um MODELO
 * intermediário comum consumido pelos dois renderers. Fronteira RC-3.5.2: o
 * DocumentConverter é acionado apenas aqui. NÃO toca no Storage/S3.
 */
export async function renderInstitutionalContent(params: {
  content: string;
  meta: InstitutionalMeta;
  format: OfficialFormat;
}): Promise<Buffer> {
  const model = buildInstitutionalModel(params.content, params.meta);
  return params.format === "docx" ? renderInstitutionalDOCX(model) : renderInstitutionalPDF(model);
}

/** Prévia (conteúdo Markdown) do documento oficial — sem gerar binário. */
export async function previewOfficialDocument(params: { organizationId: number; documentId: string }): Promise<{ document: OfficialDocument | null }> {
  const document = await getOfficialDocument(params.documentId, params.organizationId);
  return { document };
}

export { getOfficialDocument, listOfficialDocuments, listVersions, listDocumentTimeline, computeLineageId };
export type { InstitutionalMeta } from "./documentConverter";
