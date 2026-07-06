/**
 * Sprint 5.1 — Generated Documents (ETP, TR, Edital)
 *
 * Documentos são CONSEQUÊNCIA do processo, nunca o contrário. São construídos
 * automaticamente a partir do fluxo (DFD, ETP, pesquisa, itens, CATMAT, histórico,
 * copilotos) e o servidor REVISA. Determinístico.
 */

import { createHash } from "crypto";

export type DocumentKind = "etp" | "tr" | "edital";

export type DocumentStatus = "rascunho" | "em_revisao" | "aprovado";

// ─── Edital: modalidade, forma e plataforma ──────────────────────────────────

export type EditalModality =
  | "pregao"
  | "concorrencia"
  | "leilao"
  | "concurso"
  | "chamada_publica"
  | "credenciamento"
  | "registro_de_precos";

export type EditalForm = "eletronico" | "presencial";

export type EditalPlatform =
  | "compras_gov"
  | "bll"
  | "licitanet"
  | "portal_proprio"
  | "outra";

export interface GeneratedDocument {
  readonly id: string;
  readonly processId: string;
  readonly organizationId: number;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly content: string;
  readonly status: DocumentStatus;
  /** Fontes que originaram o documento (rastreabilidade). */
  readonly sources: readonly string[];
  /** Somente para Edital. */
  readonly modality: EditalModality | null;
  readonly form: EditalForm | null;
  readonly platform: EditalPlatform | null;
  readonly legalJustification: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createGeneratedDocument(params: {
  processId: string;
  organizationId: number;
  kind: DocumentKind;
  title: string;
  content?: string;
  sources?: string[];
  modality?: EditalModality | null;
  form?: EditalForm | null;
  platform?: EditalPlatform | null;
  legalJustification?: string;
  correlationId: string;
  createdAt?: string;
}): GeneratedDocument {
  const id = createHash("sha256")
    .update(`gdoc:${params.organizationId}:${params.processId}:${params.kind}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    processId: params.processId,
    organizationId: params.organizationId,
    kind: params.kind,
    title: params.title,
    content: params.content ?? "",
    status: "rascunho",
    sources: params.sources ?? [],
    modality: params.modality ?? null,
    form: params.form ?? null,
    platform: params.platform ?? null,
    legalJustification: params.legalJustification ?? "",
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function approveDocument(doc: GeneratedDocument, at?: string): GeneratedDocument {
  return { ...doc, status: "aprovado", updatedAt: at ?? new Date().toISOString() };
}

/**
 * Regra do Edital: forma presencial EXIGE justificativa legal automática;
 * eletrônico EXIGE plataforma definida.
 */
export function validateEdital(doc: GeneratedDocument): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (doc.kind !== "edital") return { valid: true, violations };
  if (!doc.modality) violations.push("Edital sem modalidade definida.");
  if (!doc.form) violations.push("Edital sem forma (eletrônico/presencial).");
  if (doc.form === "presencial" && doc.legalJustification.trim().length === 0) {
    violations.push("Edital presencial exige justificativa legal.");
  }
  if (doc.form === "eletronico" && !doc.platform) {
    violations.push("Edital eletrônico exige plataforma definida.");
  }
  return { valid: violations.length === 0, violations };
}

/** Justificativa legal padrão para modalidade presencial (revisável pelo servidor). */
export function defaultPresencialJustification(modality: EditalModality): string {
  return `Justificativa para adoção da forma presencial na modalidade ${modality}, nos termos do art. 17, §2º da Lei 14.133/2021, a ser revisada e validada pelo servidor competente.`;
}
