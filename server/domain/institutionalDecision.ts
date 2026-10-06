/**
 * R4 / R4.1 + PR-07 (SEM-004) — Contrato técnico de DECISÃO INSTITUCIONAL (ledger append-only).
 *
 * Fonte normativa do contrato: este cabeçalho + `docs/architecture/INSTITUTIONAL_DECISION_CONTRACT.md`.
 *
 * Separação obrigatória (INV-13): QUEM DECIDIU (`decidedBy*`, a autoridade declarada no ato) nunca é inferido de
 * QUEM REGISTROU (`recordedByUserId`, o usuário autenticado que clicou). O sistema registra a autoridade declarada,
 * a data e a referência do ato; ele NÃO valida competência jurídica: a política de autoridade competente é insumo
 * jurídico pendente (R4.2, `docs/audits/LEGAL_REVIEW_DECISION_PACKET.md`). Por isso toda decisão gravada sai com
 * `authorityValidation = "NOT_VALIDATED_POLICY_PENDING"` — nunca "validada" por conveniência.
 *
 * Regras (puras, determinísticas, sem banco):
 *  - sem default de resultado: `outcome` é obrigatório e pertence ao catálogo do tipo de decisão (nada de
 *    "ratificado" implícito);
 *  - campos do ato obrigatórios (fail-closed): autoridade declarada (nome e cargo/função), data do ato,
 *    referência do ato e justificativa; ausência ⇒ recusa antes de qualquer escrita;
 *  - revisão monotônica com CAS: o pedido traz `expectedRevision` (0 quando não há decisão); diferente da
 *    revisão atual ⇒ `DECISION_STALE_REVISION`;
 *  - superação explícita: revisão > 1 referencia a decisão superada (`supersedesDecisionId`); a anterior
 *    permanece no ledger (append-only), nunca é editada;
 *  - idempotência (INV-11): mesma chave + mesmo pedido ⇒ mesma decisão (sem escrita);
 *    mesma chave + pedido diferente ⇒ `DECISION_IDEMPOTENCY_CONFLICT`.
 */
import { createHash } from "crypto";

/** Catálogo fechado de tipos de decisão e seus resultados admissíveis (sem semântica jurídica além do rótulo). */
export const DECISION_OUTCOMES = {
  ratification: ["ratificado", "nao_ratificado"],
} as const satisfies Record<string, readonly string[]>;
export type InstitutionalDecisionType = keyof typeof DECISION_OUTCOMES;

/** Assuntos que admitem decisão registrada. */
export const DECISION_SUBJECT_TYPES = ["direct_procurement.ratification"] as const;
export type DecisionSubjectType = (typeof DECISION_SUBJECT_TYPES)[number];

/** Estado de validação de autoridade. Só existe o valor "pendente de política" enquanto R4.2 não for respondida. */
export const AUTHORITY_NOT_VALIDATED = "NOT_VALIDATED_POLICY_PENDING" as const;
export type AuthorityValidation = typeof AUTHORITY_NOT_VALIDATED;

export const DECISION_FIELDS_REQUIRED = "DECISION_FIELDS_REQUIRED";
export const DECISION_OUTCOME_INVALID = "DECISION_OUTCOME_INVALID";
export const DECISION_STALE_REVISION = "DECISION_STALE_REVISION";
export const DECISION_IDEMPOTENCY_CONFLICT = "DECISION_IDEMPOTENCY_CONFLICT";

export interface DecisionRequest {
  readonly organizationId: number;
  readonly subjectType: DecisionSubjectType;
  readonly subjectId: string;
  readonly decisionType: InstitutionalDecisionType;
  readonly outcome: string;
  readonly decidedByName: string;
  readonly decidedByRole: string;
  /** Usuário do sistema que é a própria autoridade declarada, se houver (opcional; nunca inferido do registrador). */
  readonly decidedByUserId: number | null;
  /** Data do ato (AAAA-MM-DD). */
  readonly decidedAt: string;
  readonly basisReference: string;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly recordedByUserId: number;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface InstitutionalDecision {
  readonly id: string;
  readonly organizationId: number;
  readonly subjectType: DecisionSubjectType;
  readonly subjectId: string;
  readonly decisionType: InstitutionalDecisionType;
  readonly outcome: string;
  readonly revision: number;
  readonly supersedesDecisionId: string | null;
  readonly decidedByName: string;
  readonly decidedByRole: string;
  readonly decidedByUserId: number | null;
  readonly decidedAt: string;
  readonly basisReference: string;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly recordedByUserId: number;
  readonly authorityValidation: AuthorityValidation;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

/** Normaliza o pedido (trim; evidências vazias descartadas, ordem preservada). Pura. */
export function normalizeDecisionRequest(r: DecisionRequest): DecisionRequest {
  return {
    ...r,
    subjectId: clean(r.subjectId), outcome: clean(r.outcome), decidedByName: clean(r.decidedByName),
    decidedByRole: clean(r.decidedByRole), decidedAt: clean(r.decidedAt), basisReference: clean(r.basisReference),
    reason: clean(r.reason), evidence: r.evidence.map(clean).filter(Boolean), idempotencyKey: clean(r.idempotencyKey),
  };
}

/** Hash do conteúdo SEMÂNTICO do pedido (sem correlationId nem ator técnico de transporte). */
export function decisionRequestHash(r: DecisionRequest): string {
  const n = normalizeDecisionRequest(r);
  return createHash("sha256").update(JSON.stringify([
    "idc-req-v1", n.organizationId, n.subjectType, n.subjectId, n.decisionType, n.outcome, n.decidedByName,
    n.decidedByRole, n.decidedByUserId, n.decidedAt, n.basisReference, n.reason, n.evidence, n.recordedByUserId,
    n.expectedRevision,
  ])).digest("hex");
}

/** Id determinístico por (órgão, assunto, revisão): duas gravações concorrentes da mesma revisão colidem na PK. */
export function decisionId(organizationId: number, subjectType: string, subjectId: string, revision: number): string {
  return "idc_" + createHash("sha256").update(`idc:${organizationId}:${subjectType}:${subjectId}:${revision}`).digest("hex").slice(0, 20);
}

export type DecisionValidation = { ok: true } | { ok: false; code: string; fields?: string[] };

/** Validação fail-closed dos campos do ato. Pura. */
export function validateDecisionRequest(raw: DecisionRequest): DecisionValidation {
  const r = normalizeDecisionRequest(raw);
  const missing: string[] = [];
  if (!r.subjectId) missing.push("subjectId");
  if (!r.decidedByName) missing.push("decidedByName");
  if (!r.decidedByRole) missing.push("decidedByRole");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.decidedAt) || Number.isNaN(Date.parse(`${r.decidedAt}T00:00:00Z`))) missing.push("decidedAt");
  if (!r.basisReference) missing.push("basisReference");
  if (r.reason.length < 10) missing.push("reason");
  if (r.idempotencyKey.length < 8) missing.push("idempotencyKey");
  if (!Number.isInteger(r.expectedRevision) || r.expectedRevision < 0) missing.push("expectedRevision");
  if (missing.length > 0) return { ok: false, code: DECISION_FIELDS_REQUIRED, fields: missing };
  const allowed = DECISION_OUTCOMES[r.decisionType] as readonly string[] | undefined;
  if (!allowed || !allowed.includes(r.outcome)) return { ok: false, code: DECISION_OUTCOME_INVALID };
  return { ok: true };
}

export type DecisionPlan =
  | { readonly kind: "replay"; readonly decision: InstitutionalDecision }
  | { readonly kind: "conflict"; readonly code: typeof DECISION_IDEMPOTENCY_CONFLICT | typeof DECISION_STALE_REVISION; readonly currentRevision: number }
  | { readonly kind: "insert"; readonly decision: InstitutionalDecision };

/**
 * Decide o que fazer com um pedido VALIDADO, dado o estado lido sob lock: a decisão já gravada com a mesma chave
 * (se houver) e a decisão corrente do assunto (maior revisão). Pura e determinística.
 */
export function planDecision(
  raw: DecisionRequest,
  state: { byIdempotencyKey: InstitutionalDecision | null; current: InstitutionalDecision | null },
): DecisionPlan {
  const r = normalizeDecisionRequest(raw);
  const requestHash = decisionRequestHash(r);
  const currentRevision = state.current?.revision ?? 0;
  if (state.byIdempotencyKey) {
    return state.byIdempotencyKey.requestHash === requestHash
      ? { kind: "replay", decision: state.byIdempotencyKey }
      : { kind: "conflict", code: DECISION_IDEMPOTENCY_CONFLICT, currentRevision };
  }
  if (r.expectedRevision !== currentRevision) return { kind: "conflict", code: DECISION_STALE_REVISION, currentRevision };
  const revision = currentRevision + 1;
  return {
    kind: "insert",
    decision: {
      id: decisionId(r.organizationId, r.subjectType, r.subjectId, revision),
      organizationId: r.organizationId, subjectType: r.subjectType, subjectId: r.subjectId, decisionType: r.decisionType,
      outcome: r.outcome, revision, supersedesDecisionId: state.current?.id ?? null,
      decidedByName: r.decidedByName, decidedByRole: r.decidedByRole, decidedByUserId: r.decidedByUserId,
      decidedAt: r.decidedAt, basisReference: r.basisReference, reason: r.reason, evidence: r.evidence,
      recordedByUserId: r.recordedByUserId, authorityValidation: AUTHORITY_NOT_VALIDATED,
      correlationId: r.correlationId, idempotencyKey: r.idempotencyKey, requestHash,
    },
  };
}

export const DECISION_MESSAGES: Record<string, string> = {
  [DECISION_FIELDS_REQUIRED]:
    `Registro de decisão incompleto: informe a autoridade que decidiu (nome e cargo), a data e a referência do ato e a justificativa (mín. 10 caracteres). Nada foi gravado (${DECISION_FIELDS_REQUIRED}).`,
  [DECISION_OUTCOME_INVALID]: `Selecione explicitamente o resultado da decisão; não há resultado padrão (${DECISION_OUTCOME_INVALID}).`,
  [DECISION_STALE_REVISION]:
    `A decisão foi alterada por outra pessoa desde que você abriu a tela. Recarregue para ver a decisão atual antes de registrar uma nova (${DECISION_STALE_REVISION}).`,
  [DECISION_IDEMPOTENCY_CONFLICT]:
    `Esta solicitação já foi usada para registrar uma decisão com conteúdo diferente. Nada foi gravado (${DECISION_IDEMPOTENCY_CONFLICT}).`,
};
