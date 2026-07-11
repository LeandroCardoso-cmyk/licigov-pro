/**
 * FASE 5 — Business Domain: Parecer Jurídico
 *
 * LegalOpinionDraft é o PARECER em si — o produto do trabalho do Procurador.
 * Todo o conteúdo é editável e revisável (nunca emitido automaticamente).
 * A assinatura, nesta fase, é apenas MANUAL; a arquitetura está preparada para
 * ICP-Brasil, GOV.BR e Certificado A1 (não implementados).
 *
 * Determinístico, multi-tenant, replay-safe.
 */

import { createHash } from "crypto";

/**
 * Tipos de parecer. Inicialmente inicial/final; a arquitetura aceita novos
 * tipos sem alterar o Kernel (basta estender esta união e os mapeamentos).
 */
export type LegalOpinionType =
  | "LEGAL_OPINION_INITIAL"
  | "LEGAL_OPINION_FINAL";

export type LegalOpinionConclusion =
  | "favoravel"
  | "desfavoravel"
  | "com_ressalvas"
  | "parcialmente_favoravel";

export type LegalOpinionDraftStatus = "rascunho" | "em_revisao" | "assinado";

/** Métodos de assinatura. Apenas "manual" implementado nesta fase. */
export type SignatureMethod = "manual" | "icp_brasil" | "gov_br" | "certificado_a1";

/** Métodos de assinatura efetivamente implementados nesta fase. */
export const IMPLEMENTED_SIGNATURE_METHODS: readonly SignatureMethod[] = ["manual"];

export function isSignatureMethodImplemented(method: SignatureMethod): boolean {
  return IMPLEMENTED_SIGNATURE_METHODS.includes(method);
}

export interface LegalOpinionDraft {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly requestId: string;
  readonly opinionType: LegalOpinionType;
  /** Estrutura do parecer — toda editável. */
  readonly report: string;          // relatório
  readonly foundation: string;      // fundamentação
  readonly conclusion: string;      // conclusão (texto)
  readonly conclusionType: LegalOpinionConclusion | null;
  readonly recommendations: readonly string[];
  readonly reservations: readonly string[];
  readonly attachments: readonly string[]; // referências (nunca cópia)
  readonly status: LegalOpinionDraftStatus;
  readonly version: number;
  readonly signed: boolean;
  readonly signatureMethod: SignatureMethod | null;
  readonly signedBy: number | null;
  readonly signedAt: string | null;
  readonly author: number;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createLegalOpinionDraft(params: {
  organizationId: number;
  workspaceId: string;
  requestId: string;
  opinionType: LegalOpinionType;
  author: number;
  report?: string;
  foundation?: string;
  conclusion?: string;
  conclusionType?: LegalOpinionConclusion | null;
  recommendations?: string[];
  reservations?: string[];
  attachments?: string[];
  correlationId: string;
  createdAt?: string;
}): LegalOpinionDraft {
  const id = createHash("sha256")
    .update(`lod:${params.organizationId}:${params.workspaceId}:${params.opinionType}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    requestId: params.requestId,
    opinionType: params.opinionType,
    report: params.report ?? "",
    foundation: params.foundation ?? "",
    conclusion: params.conclusion ?? "",
    conclusionType: params.conclusionType ?? null,
    recommendations: params.recommendations ?? [],
    reservations: params.reservations ?? [],
    attachments: params.attachments ?? [],
    status: "rascunho",
    version: 1,
    signed: false,
    signatureMethod: null,
    signedBy: null,
    signedAt: null,
    author: params.author,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Atualiza o conteúdo do parecer, incrementando a versão. Bloqueado se assinado. */
export function updateLegalOpinionDraft(
  draft: LegalOpinionDraft,
  patch: Partial<Pick<LegalOpinionDraft,
    "report" | "foundation" | "conclusion" | "conclusionType" | "recommendations" | "reservations" | "attachments">>,
  at?: string,
): LegalOpinionDraft {
  if (draft.signed) {
    throw new Error("Parecer assinado é imutável — não pode ser editado.");
  }
  return {
    ...draft,
    ...patch,
    version: draft.version + 1,
    status: "em_revisao",
    updatedAt: at ?? new Date().toISOString(),
  };
}

/**
 * Assina o parecer. Apenas o método MANUAL é implementado nesta fase; os demais
 * lançam erro explícito (arquitetura preparada, comportamento não implementado).
 */
export function signLegalOpinionDraft(
  draft: LegalOpinionDraft,
  method: SignatureMethod,
  signedBy: number,
  at?: string,
): LegalOpinionDraft {
  if (!isSignatureMethodImplemented(method)) {
    throw new Error(`Método de assinatura "${method}" ainda não implementado (arquitetura preparada).`);
  }
  const ts = at ?? new Date().toISOString();
  return {
    ...draft,
    signed: true,
    signatureMethod: method,
    signedBy,
    signedAt: ts,
    status: "assinado",
    updatedAt: ts,
  };
}

/** Assinatura determinística do conteúdo (para rastreabilidade/versão). */
export function draftContentHash(draft: LegalOpinionDraft): string {
  return createHash("sha256").update(JSON.stringify({
    report: draft.report, foundation: draft.foundation, conclusion: draft.conclusion,
    conclusionType: draft.conclusionType, recommendations: draft.recommendations,
    reservations: draft.reservations, attachments: draft.attachments, version: draft.version,
  })).digest("hex").slice(0, 32);
}
