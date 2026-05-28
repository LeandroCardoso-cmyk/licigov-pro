/**
 * Sprint 2.95 — Review Contracts.
 *
 * Contrato imutável de revisão para cada item de staging.
 * Cada decisão é append-only; nunca se modifica o histórico.
 * Rastreabilidade completa para auditoria jurídica (Lei 14.133/2021).
 */

import { nanoid } from "nanoid";
import type { ReviewActor } from "./importReviewState";

// ─── Operation types ──────────────────────────────────────────────────────────

export type ReviewOperation =
  | "compare_candidates"   // comparar candidatos side-by-side
  | "approve_candidate"    // aprovar candidato específico
  | "reject_candidate"     // rejeitar candidato específico
  | "override_candidate"   // sobrescrever com valor manual
  | "request_manual_entry" // solicitar entrada manual de dados
  | "request_new_search"   // solicitar nova busca semântica
  | "attach_evidence"      // anexar evidência ao processo
  | "justify_decision"     // adicionar justificativa
  | "escalate_review";     // escalar para revisor de nível superior

// ─── Decision ─────────────────────────────────────────────────────────────────

export interface ReviewDecision {
  id:              string;
  stagingItemId:   string;
  importSessionId: number;
  organizationId:  number;
  operation:       ReviewOperation;
  actor:           ReviewActor;
  candidateId?:    string;
  overrideValue?: {
    description?: string;
    unit?:        string;
    quantity?:    number;
    unitPrice?:   number;
  };
  justification:  string; // required, min 1 char
  evidenceRefs:   string[];
  escalateTo?:    number; // userId
  createdAt:      string; // ISO 8601
}

// ─── Contract ─────────────────────────────────────────────────────────────────

export interface ReviewContract {
  stagingItemId:    string;
  importSessionId:  number;
  organizationId:   number;
  decisions:        ReviewDecision[]; // append-only
  currentOperation: ReviewOperation | null;
  isFinalized:      boolean;
  finalizedAt?:     string;
  createdAt:        string; // ISO 8601
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateJustification(justification: string): {
  valid:   boolean;
  reason?: string;
} {
  if (!justification || justification.trim().length === 0) {
    return { valid: false, reason: "Justificativa não pode ser vazia." };
  }
  if (justification.trim().length < 5) {
    return {
      valid:  false,
      reason: `Justificativa muito curta (${justification.trim().length} chars, mínimo 5).`,
    };
  }
  return { valid: true };
}

// ─── Contract factory ─────────────────────────────────────────────────────────

export function createContract(
  stagingItemId:   string,
  importSessionId: number,
  organizationId:  number,
): ReviewContract {
  return {
    stagingItemId,
    importSessionId,
    organizationId,
    decisions:        [],
    currentOperation: null,
    isFinalized:      false,
    createdAt:        new Date().toISOString(),
  };
}

// ─── Mutation (immutable — returns new contract) ──────────────────────────────

export function addDecision(
  contract:  ReviewContract,
  decision:  ReviewDecision,
): ReviewContract {
  if (contract.isFinalized) {
    throw new Error(
      `ReviewContract para stagingItemId="${contract.stagingItemId}" já está finalizado — não é possível adicionar decisões.`,
    );
  }
  return {
    ...contract,
    decisions:        [...contract.decisions, decision],
    currentOperation: decision.operation,
  };
}

export function finalizeContract(
  contract:     ReviewContract,
  actor:        ReviewActor,
  justification: string,
): ReviewContract {
  const validation = validateJustification(justification);
  if (!validation.valid) {
    throw new Error(`Justificativa inválida: ${validation.reason}`);
  }
  const now = new Date().toISOString();
  const finalizationDecision: ReviewDecision = {
    id:              nanoid(),
    stagingItemId:   contract.stagingItemId,
    importSessionId: contract.importSessionId,
    organizationId:  contract.organizationId,
    operation:       "justify_decision",
    actor,
    justification,
    evidenceRefs:    [],
    createdAt:       now,
  };
  return {
    ...contract,
    decisions:    [...contract.decisions, finalizationDecision],
    isFinalized:  true,
    finalizedAt:  now,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getLastDecision(contract: ReviewContract): ReviewDecision | null {
  return contract.decisions[contract.decisions.length - 1] ?? null;
}

export function getDecisionsByOperation(
  contract:  ReviewContract,
  op:        ReviewOperation,
): ReviewDecision[] {
  return contract.decisions.filter(d => d.operation === op);
}

export function hasOperation(
  contract:  ReviewContract,
  op:        ReviewOperation,
): boolean {
  return contract.decisions.some(d => d.operation === op);
}

// ─── Decision factories ───────────────────────────────────────────────────────

function buildDecision(
  contract:    ReviewContract,
  operation:   ReviewOperation,
  actor:       ReviewActor,
  justification: string,
  extras: Partial<Pick<ReviewDecision, "candidateId" | "overrideValue" | "evidenceRefs" | "escalateTo">> = {},
): ReviewDecision {
  return {
    id:              nanoid(),
    stagingItemId:   contract.stagingItemId,
    importSessionId: contract.importSessionId,
    organizationId:  contract.organizationId,
    operation,
    actor,
    justification,
    evidenceRefs:    extras.evidenceRefs ?? [],
    candidateId:     extras.candidateId,
    overrideValue:   extras.overrideValue,
    escalateTo:      extras.escalateTo,
    createdAt:       new Date().toISOString(),
  };
}

export function compareCandidates(
  contract:     ReviewContract,
  actor:        ReviewActor,
  candidateIds: string[],
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "compare_candidates", actor, justification, {
    candidateId: candidateIds[0],
    evidenceRefs: candidateIds,
  });
  return addDecision(contract, decision);
}

export function approveCandidate(
  contract:     ReviewContract,
  actor:        ReviewActor,
  candidateId:  string,
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "approve_candidate", actor, justification, {
    candidateId,
  });
  return addDecision(contract, decision);
}

export function rejectCandidate(
  contract:     ReviewContract,
  actor:        ReviewActor,
  candidateId:  string,
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "reject_candidate", actor, justification, {
    candidateId,
  });
  return addDecision(contract, decision);
}

export function overrideCandidate(
  contract:     ReviewContract,
  actor:        ReviewActor,
  value:        NonNullable<ReviewDecision["overrideValue"]>,
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "override_candidate", actor, justification, {
    overrideValue: value,
  });
  return addDecision(contract, decision);
}

export function requestManualEntry(
  contract:     ReviewContract,
  actor:        ReviewActor,
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "request_manual_entry", actor, justification);
  return addDecision(contract, decision);
}

export function requestNewSearch(
  contract:     ReviewContract,
  actor:        ReviewActor,
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "request_new_search", actor, justification);
  return addDecision(contract, decision);
}

export function attachEvidence(
  contract:     ReviewContract,
  actor:        ReviewActor,
  refs:         string[],
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "attach_evidence", actor, justification, {
    evidenceRefs: refs,
  });
  return addDecision(contract, decision);
}

export function justifyDecision(
  contract:     ReviewContract,
  actor:        ReviewActor,
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "justify_decision", actor, justification);
  return addDecision(contract, decision);
}

export function escalateReview(
  contract:     ReviewContract,
  actor:        ReviewActor,
  escalateTo:   number,
  justification: string,
): ReviewContract {
  const decision = buildDecision(contract, "escalate_review", actor, justification, {
    escalateTo,
  });
  return addDecision(contract, decision);
}
