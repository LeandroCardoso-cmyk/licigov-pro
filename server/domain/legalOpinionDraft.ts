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

// ─── R3 / PR-06 (SEM-006) — Create ≠ Reset ────────────────────────────────────
//
// Chave natural do parecer = o `id` determinístico hash(org, workspace, tipo). Um workspace comporta UM parecer:
// criar sobre um workspace que já tem parecer NUNCA regrava o existente. Tokens estáveis (não traduzir; usados por
// testes e cliente) vão na mensagem pt-BR do CONFLICT.

/** Já existe parecer (não assinado) neste workspace e a chamada não é retry da MESMA criação. */
export const LEGAL_OPINION_ALREADY_EXISTS = "LEGAL_OPINION_ALREADY_EXISTS";
/** O workspace já tem parecer ASSINADO — imutável; nenhuma criação/rascunho o altera. */
export const LEGAL_OPINION_ALREADY_SIGNED = "LEGAL_OPINION_ALREADY_SIGNED";
/** A etapa do workspace não admite iniciar rascunho (validada ANTES de qualquer escrita). */
export const LEGAL_OPINION_STAGE_INVALID = "LEGAL_OPINION_STAGE_INVALID";

export const LEGAL_OPINION_ALREADY_EXISTS_MESSAGE =
  `Já existe um parecer neste trabalho. A criação não altera o parecer existente — edite-o para gerar nova versão (${LEGAL_OPINION_ALREADY_EXISTS}).`;
export const LEGAL_OPINION_ALREADY_SIGNED_MESSAGE =
  `Este trabalho já tem parecer assinado, que é imutável — nenhuma criação ou rascunho pode alterá-lo (${LEGAL_OPINION_ALREADY_SIGNED}).`;
export function legalOpinionStageInvalidMessage(stage: string): string {
  return `A etapa atual do trabalho (${stage}) não permite iniciar o parecer; nada foi gravado (${LEGAL_OPINION_STAGE_INVALID}).`;
}

/**
 * Retry idempotente da MESMA criação: mesmo ator, mesmo tipo e mesmo payload NORMALIZADO (omitidos ≡ vazios, como
 * em `createLegalOpinionDraft`), e o parecer existente ainda no estado exato que a criação produz (rascunho v1, não
 * assinado). Qualquer outra coisa (texto diferente, outro ator, parecer já editado/assinado) ⇒ CONFLICT.
 */
export function isSameLegalOpinionDraftCreate(existing: LegalOpinionDraft, candidate: LegalOpinionDraft): boolean {
  const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return existing.id === candidate.id
    && existing.organizationId === candidate.organizationId
    && existing.workspaceId === candidate.workspaceId
    && existing.opinionType === candidate.opinionType
    && !existing.signed
    && existing.status === "rascunho"
    && existing.version === 1
    && existing.author === candidate.author
    && existing.report === candidate.report
    && existing.foundation === candidate.foundation
    && existing.conclusion === candidate.conclusion
    && (existing.conclusionType ?? null) === (candidate.conclusionType ?? null)
    && sameList(existing.recommendations, candidate.recommendations)
    && sameList(existing.reservations, candidate.reservations)
    && sameList(existing.attachments, candidate.attachments);
}

export type LegalOpinionCreateDecision =
  | { readonly kind: "create" }
  | { readonly kind: "converge"; readonly draft: LegalOpinionDraft }
  | { readonly kind: "conflict"; readonly reason: typeof LEGAL_OPINION_ALREADY_EXISTS | typeof LEGAL_OPINION_ALREADY_SIGNED };

/**
 * Decide a criação dado TODOS os pareceres já existentes no workspace (qualquer tipo). Pura e determinística.
 * Assinado em qualquer tipo ⇒ ALREADY_SIGNED; retry exato ⇒ converge (sem escrita); outro existente ⇒ ALREADY_EXISTS.
 */
export function decideLegalOpinionDraftCreate(
  existing: readonly LegalOpinionDraft[], candidate: LegalOpinionDraft,
): LegalOpinionCreateDecision {
  if (existing.length === 0) return { kind: "create" };
  if (existing.some(d => d.signed || d.status === "assinado")) return { kind: "conflict", reason: LEGAL_OPINION_ALREADY_SIGNED };
  const same = existing.length === 1 ? existing[0] : undefined;
  if (same && isSameLegalOpinionDraftCreate(same, candidate)) return { kind: "converge", draft: same };
  return { kind: "conflict", reason: LEGAL_OPINION_ALREADY_EXISTS };
}

/** Assinatura determinística do conteúdo (para rastreabilidade/versão). */
export function draftContentHash(draft: LegalOpinionDraft): string {
  return createHash("sha256").update(JSON.stringify({
    report: draft.report, foundation: draft.foundation, conclusion: draft.conclusion,
    conclusionType: draft.conclusionType, recommendations: draft.recommendations,
    reservations: draft.reservations, attachments: draft.attachments, version: draft.version,
  })).digest("hex").slice(0, 32);
}
