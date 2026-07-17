/**
 * RC-4.9 — Official Knowledge Corpus · Classificação do documento oficial (Fase 5).
 *
 * Metadados de classificação de todo documento oficial incorporado. Multi-tenant (tenantId quando
 * municipal), determinístico (id/replayHash via sha256). Sem RAG/IA/chat — apenas metadados +
 * referência ao conteúdo (KnowledgeDocument produzido pelo Institutional Knowledge Framework).
 */

import { createHash } from "crypto";

export type OfficialDocumentType =
  | "lei" | "lei_complementar" | "decreto" | "instrucao_normativa" | "acordao"
  | "orientacao_tecnica" | "parecer" | "manual" | "decreto_municipal" | "normativa_interna" | "modelo_oficial"
  | "prejulgado" | "municipal_law";

export type Esfera = "federal" | "estadual" | "municipal";
export type OfficialDocumentStatus = "vigente" | "revogado" | "publicado";

/** Nível de vinculação institucional do documento (RC-4.9.1). */
export type BindingLevel = "mandatory" | "prejulgado_tce" | "orientacao" | "referencia";

export interface OfficialDocument {
  readonly documentId: string;
  readonly documentType: OfficialDocumentType;
  readonly authority: string;
  readonly jurisdiction: Esfera;
  readonly scope: Esfera;
  /** Tenant municipal (null para federal/estadual). */
  readonly tenantId: number | null;
  readonly state: string | null;
  readonly municipality: string | null;
  readonly effectiveDate: string | null;
  readonly source: string;
  readonly version: string;
  readonly status: OfficialDocumentStatus;
  readonly language: string;
  /** Nível de vinculação institucional (mandatory/prejulgado_tce/orientacao/referencia). */
  readonly bindingLevel: BindingLevel;
  /** Identificador oficial da norma (ex.: "lei-14133-2021"). */
  readonly normId: string;
  readonly title: string;
  /** Referência ao KnowledgeDocument publicado (id) — o conteúdo verbatim vive lá. */
  readonly knowledgeDocumentId: string | null;
  readonly replayHash: string;
}

function computeReplayHash(d: Omit<OfficialDocument, "documentId" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    type: d.documentType, authority: d.authority, jurisdiction: d.jurisdiction, scope: d.scope,
    tenant: d.tenantId, state: d.state, municipality: d.municipality, effective: d.effectiveDate,
    source: d.source, version: d.version, status: d.status, language: d.language, binding: d.bindingLevel,
    norm: d.normId, title: d.title, kdoc: d.knowledgeDocumentId,
  })).digest("hex").slice(0, 32);
}

export interface CreateOfficialDocumentParams {
  documentType: OfficialDocumentType;
  authority: string;
  jurisdiction: Esfera;
  scope?: Esfera;
  tenantId?: number | null;
  state?: string | null;
  municipality?: string | null;
  effectiveDate?: string | null;
  source: string;
  version?: string;
  status?: OfficialDocumentStatus;
  language?: string;
  bindingLevel?: BindingLevel;
  normId: string;
  title: string;
  knowledgeDocumentId?: string | null;
}

/** Cria a classificação de um documento oficial. Determinística. */
export function classifyOfficialDocument(params: CreateOfficialDocumentParams): OfficialDocument {
  const base: Omit<OfficialDocument, "documentId" | "replayHash"> = {
    documentType: params.documentType, authority: params.authority, jurisdiction: params.jurisdiction,
    scope: params.scope ?? params.jurisdiction, tenantId: params.tenantId ?? null,
    state: params.state ?? null, municipality: params.municipality ?? null,
    effectiveDate: params.effectiveDate ?? null, source: params.source, version: params.version ?? "1.0.0",
    status: params.status ?? "vigente", language: params.language ?? "pt-BR",
    bindingLevel: params.bindingLevel ?? "referencia", normId: params.normId,
    title: params.title, knowledgeDocumentId: params.knowledgeDocumentId ?? null,
  };
  const replayHash = computeReplayHash(base);
  const documentId = createHash("sha256").update(`odoc:${params.jurisdiction}:${params.tenantId ?? "-"}:${params.normId}:${base.version}`).digest("hex").slice(0, 20);
  return { documentId, ...base, replayHash };
}

/** Prioridade de esfera para resolução hierárquica (Fase 6): menor = mais alta. */
export const ESFERA_PRIORITY: Record<Esfera, number> = { federal: 0, estadual: 1, municipal: 2 };

export function isValidOfficialDocument(d: OfficialDocument): boolean {
  return d.normId.length > 0 && d.title.length > 0 && d.source.length > 0
    && (d.jurisdiction !== "municipal" || (d.tenantId !== null && d.municipality !== null));
}
