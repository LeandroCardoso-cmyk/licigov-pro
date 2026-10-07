/**
 * EVIDÊNCIA DE APROVAÇÃO JURÍDICA (piloto Edital) — domínio puro.
 *
 * Registra, como EVIDÊNCIA DE GOVERNANÇA (não como status), que uma pessoa informou ao sistema que o conteúdo-fonte congelado
 * (versão lógica + SHA-256) foi aprovado juridicamente fora do sistema (ex.: Procuradoria sobre o conteúdo 1.0.1-draft).
 *
 *  - O ciclo de vida permanece DRAFT → APPROVED → PUBLISHED → DEPRECATED; esta evidência NUNCA transita a revisão e NUNCA a
 *    substitui: a aprovação e a publicação no sistema são decisões humanas distintas.
 *  - NADA é inventado: número/data do parecer, protocolo e procurador são metadados OPCIONAIS — ausentes se não informados.
 *  - O sistema não valida a competência de quem aprovou (autoridade segue NOT_VALIDATED_POLICY_PENDING) nem o teor jurídico.
 *  - Preserva: versão lógica da fonte, SHA-256 da fonte, hash semântico da revisão ligada, quem REGISTROU (usuário
 *    autenticado — `recordedByUserId` do ledger), instante do registro e as referências/base informadas.
 */
import type { InstitutionalDecision } from "../../institutionalDecision";
import { isSha256 } from "../types";
import { decodeKv, encodeKv, KV_MAX_VALUE } from "./kv";

export const LEGAL_EVIDENCE_SUBJECT = "institutional_template.legal_evidence" as const;
export const LEGAL_EVIDENCE_DECISION_TYPE = "template_legal_approval_evidence" as const;
export const LEGAL_EVIDENCE_OUTCOME = "registrado" as const;

const REQUIRED_KEYS = ["sourceLogicalVersion", "sourceSha256", "revisionSemanticHash", "recordedAt"] as const;
const OPTIONAL_KEYS = ["parecerNumber", "parecerDate", "protocol", "procurador"] as const;
const REF_KEY = "ref";
const ALL_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS, REF_KEY] as const;

/** Entrada humana. Os quatro metadados opcionais NUNCA recebem valor padrão: ausentes ⇒ não gravados. */
export interface LegalEvidenceInput {
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: string;
  readonly parecerNumber?: string;
  readonly parecerDate?: string;
  readonly protocol?: string;
  readonly procurador?: string;
  /** Referências adicionais (links, números de processo, anexos) informadas por quem registra. */
  readonly evidenceRefs?: readonly string[];
}

export interface LegalApprovalEvidence {
  readonly decisionId: string;
  readonly revisionId: string;
  readonly version: number;
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: string;
  readonly revisionSemanticHash: string;
  readonly recordedByUserId: number;
  readonly recordedAt: string;
  readonly declaredBy: { readonly name: string; readonly role: string; readonly userId: number | null };
  readonly actDate: string;
  readonly basisReference: string;
  readonly reason: string;
  readonly parecerNumber: string | null;
  readonly parecerDate: string | null;
  readonly protocol: string | null;
  readonly procurador: string | null;
  readonly evidenceRefs: readonly string[];
  readonly supersedesDecisionId: string | null;
  readonly authorityValidation: "NOT_VALIDATED_POLICY_PENDING";
}

export interface EvidenceIssue { readonly field: string; readonly message: string }

const oneLine = (s: string | undefined): string => (s ?? "").trim();

export function validateLegalEvidenceInput(input: LegalEvidenceInput): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  if (!oneLine(input.sourceLogicalVersion) || /[\r\n]/.test(input.sourceLogicalVersion) || input.sourceLogicalVersion.length > 64) {
    issues.push({ field: "sourceLogicalVersion", message: "informe a versão lógica do conteúdo-fonte aprovado (ex.: 1.0.1-draft)" });
  }
  if (!isSha256(input.sourceSha256)) issues.push({ field: "sourceSha256", message: "informe o SHA-256 (64 hex minúsculos) do conteúdo-fonte aprovado" });
  for (const k of OPTIONAL_KEYS) {
    const v = input[k];
    if (v === undefined) continue;
    if (oneLine(v) === "" || /[\r\n]/.test(v) || v.length > KV_MAX_VALUE) issues.push({ field: k, message: `${k}: valor vazio ou inválido — omita o campo se não houver informação (nada é inventado)` });
  }
  if (input.parecerDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.parecerDate)) issues.push({ field: "parecerDate", message: "parecerDate deve ser AAAA-MM-DD" });
  for (const r of input.evidenceRefs ?? []) {
    if (oneLine(r) === "" || /[\r\n]/.test(r) || r.length > KV_MAX_VALUE) issues.push({ field: "evidenceRefs", message: "referência de evidência vazia ou inválida" });
  }
  return issues;
}

/** Linhas de evidência a gravar no ledger (omitindo o que não foi informado). `recordedAt` é o instante do relógio do servidor. */
export function encodeLegalEvidence(input: LegalEvidenceInput, ctx: { readonly revisionSemanticHash: string; readonly recordedAt: string }): string[] {
  const lines = [
    encodeKv("sourceLogicalVersion", input.sourceLogicalVersion),
    encodeKv("sourceSha256", input.sourceSha256),
    encodeKv("revisionSemanticHash", ctx.revisionSemanticHash),
    encodeKv("recordedAt", ctx.recordedAt),
  ];
  for (const k of OPTIONAL_KEYS) {
    const v = input[k];
    if (v !== undefined) lines.push(encodeKv(k, v));
  }
  for (const r of input.evidenceRefs ?? []) lines.push(encodeKv(REF_KEY, r));
  return lines;
}

/** Reconstrói a evidência a partir da decisão do ledger. Registro malformado/sem campos obrigatórios ⇒ `null` (nunca "meio válido"). */
export function decodeLegalEvidence(d: InstitutionalDecision): LegalApprovalEvidence | null {
  if (d.subjectType !== LEGAL_EVIDENCE_SUBJECT || d.decisionType !== LEGAL_EVIDENCE_DECISION_TYPE || d.outcome !== LEGAL_EVIDENCE_OUTCOME) return null;
  const { values, others } = decodeKv(d.evidence, ALL_KEYS);
  const refs = d.evidence.filter((l) => l.startsWith(`${REF_KEY}=`)).map((l) => l.slice(REF_KEY.length + 1));
  void others;
  for (const k of REQUIRED_KEYS) if (!values[k]) return null;
  if (!isSha256(values.sourceSha256) || !isSha256(values.revisionSemanticHash)) return null;
  return {
    decisionId: d.id, revisionId: d.subjectId, version: d.revision,
    sourceLogicalVersion: values.sourceLogicalVersion, sourceSha256: values.sourceSha256, revisionSemanticHash: values.revisionSemanticHash,
    recordedByUserId: d.recordedByUserId, recordedAt: values.recordedAt,
    declaredBy: { name: d.decidedByName, role: d.decidedByRole, userId: d.decidedByUserId },
    actDate: d.decidedAt, basisReference: d.basisReference, reason: d.reason,
    parecerNumber: values.parecerNumber ?? null, parecerDate: values.parecerDate ?? null, protocol: values.protocol ?? null, procurador: values.procurador ?? null,
    evidenceRefs: refs, supersedesDecisionId: d.supersedesDecisionId, authorityValidation: d.authorityValidation,
  };
}

/** A evidência corrente vale para a procedência da revisão? (mesma versão lógica e mesmo SHA-256 da fonte.) */
export function evidenceCoversSource(ev: LegalApprovalEvidence, source: { readonly sourceLogicalVersion: string; readonly sourceSha256: string }): boolean {
  return ev.sourceLogicalVersion === source.sourceLogicalVersion && ev.sourceSha256 === source.sourceSha256;
}
