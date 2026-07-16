/**
 * RC-3 — Official Document (modelo uniforme do Document Engine)
 *
 * Componente PERMANENTE do Cognitive Kernel: todo documento oficial do LiciGov Pro,
 * de qualquer Business Domain, é representado por este modelo único e passa pelo
 * mesmo pipeline (gerar → versionar → timeline → exportar DOCX/PDF). Nenhum domínio
 * gera documento diretamente — apenas informa dados/conteúdo/tipo ao Document Engine.
 *
 * Determinístico, replay-safe (id/lineage/replayHash via sha256), multi-tenant.
 */

import { createHash } from "crypto";

/** Domínios que produzem documentos oficiais (Centro de Operações NÃO gera — apenas referencia). */
export type DocumentBusinessDomain =
  | "processo_licitatorio"
  | "contratacao_direta"
  | "parecer_juridico"
  | "contratos";

/** Tipos documentais oficiais suportados pelo pipeline único. */
export type OfficialDocumentType =
  | "dfd" | "etp" | "tr" | "edital"
  | "justificativa_contratacao" | "justificativa_preco" | "ratificacao" | "aviso" | "extrato_contrato"
  | "parecer_inicial" | "parecer_final" | "despacho"
  | "contrato" | "aditivo" | "apostilamento" | "rescisao"
  | "outro";

export type OfficialDocumentStatus = "gerado" | "revisado" | "emitido";

export type OfficialFormat = "docx" | "pdf";
export const OFFICIAL_FORMATS: readonly OfficialFormat[] = ["docx", "pdf"];

export interface OfficialDocument {
  readonly id: string;
  readonly tenantId: number;          // organizationId (multi-tenant)
  readonly businessDomain: DocumentBusinessDomain;
  readonly documentType: OfficialDocumentType;
  /** Referência de origem (workspace/processo que originou o documento). */
  readonly origin: string;
  readonly title: string;
  readonly version: number;
  readonly status: OfficialDocumentStatus;
  readonly template: string;
  /** Conteúdo em Markdown — representação intermediária; a exportação gera DOCX/PDF. */
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly author: string;
  /** Identidade da LINHAGEM do documento (estável entre versões). */
  readonly lineageId: string;
  readonly correlationId: string;
  /** Hash determinístico do conteúdo+metadados (replay-safe). */
  readonly replayHash: string;
  // ── RC-3.5 — Referências de storage (nunca armazenar binários no banco) ──────
  /** Chave do objeto no Storage Service (S3) do último export. Vazio se ainda não exportado. */
  readonly storageKey: string;
  /** MIME type do binário exportado (DOCX/PDF). Vazio se ainda não exportado. */
  readonly mimeType: string;
  /** Tamanho em bytes do binário exportado. 0 se ainda não exportado. */
  readonly size: number;
  /** Hash sha256 do binário exportado (integridade do arquivo no storage). */
  readonly hash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** MIME type oficial por formato de exportação. */
export const OFFICIAL_MIME_TYPES: Record<OfficialFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

/** Linhagem estável de um documento (mesma origem+tipo → mesma linhagem, versões acumulam). */
export function computeLineageId(params: { tenantId: number; businessDomain: string; documentType: string; origin: string }): string {
  return createHash("sha256")
    .update(`odln:${params.tenantId}:${params.businessDomain}:${params.documentType}:${params.origin}`)
    .digest("hex").slice(0, 20);
}

export function computeReplayHash(content: string, metadata: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({ content, metadata })).digest("hex").slice(0, 32);
}

/** Cria uma NOVA versão de documento oficial (nunca sobrescreve — versão informada). */
export function createOfficialDocument(params: {
  tenantId: number;
  businessDomain: DocumentBusinessDomain;
  documentType: OfficialDocumentType;
  origin: string;
  title: string;
  content: string;
  version: number;
  template?: string;
  status?: OfficialDocumentStatus;
  metadata?: Record<string, unknown>;
  author: string;
  correlationId: string;
  createdAt?: string;
}): OfficialDocument {
  const lineageId = computeLineageId(params);
  const id = createHash("sha256")
    .update(`odoc:${params.tenantId}:${lineageId}:${params.version}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  const metadata = params.metadata ?? {};
  return {
    id,
    tenantId: params.tenantId,
    businessDomain: params.businessDomain,
    documentType: params.documentType,
    origin: params.origin,
    title: params.title,
    version: params.version,
    status: params.status ?? "gerado",
    template: params.template ?? `${params.businessDomain}_${params.documentType}`,
    content: params.content,
    metadata,
    author: params.author,
    lineageId,
    correlationId: params.correlationId,
    replayHash: computeReplayHash(params.content, metadata),
    storageKey: "",
    mimeType: "",
    size: 0,
    hash: "",
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Nome de arquivo canônico para exportação. */
export function officialFilename(doc: OfficialDocument, format: OfficialFormat): string {
  const safe = `${doc.documentType}_${doc.title}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${safe || doc.documentType}-v${doc.version}.${format}`;
}
