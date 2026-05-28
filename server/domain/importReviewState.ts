/**
 * Sprint 2.9 — Review State Machine.
 *
 * Máquina de estados para revisão de itens extraídos.
 * Garante rastreabilidade total (quem, quando, de qual estado, para qual estado).
 * Toda transição é imutável e auditável.
 */

// ─── States ───────────────────────────────────────────────────────────────────

export type ReviewState =
  | "extracted"      // item extraído pelo parser, bruto
  | "normalized"     // unidade + quantidade normalizadas
  | "review_pending" // aguardando decisão humana
  | "reviewed"       // revisor interagiu (ainda não finalizou)
  | "approved"       // aprovado pelo revisor
  | "rejected"       // rejeitado (descartado desta sessão)
  | "corrected"      // revisor corrigiu um ou mais campos
  | "catmat_linked"  // vinculado ao catálogo CATMAT/CATSER
  | "finalized";     // consolidado no domínio final

// ─── Actor types ──────────────────────────────────────────────────────────────

export type ReviewActorType = "system" | "human" | "ai_assist";

export interface ReviewActor {
  type:           ReviewActorType;
  userId?:        number;
  userEmail?:     string;
  organizationId: number;
  agentId?:       string; // para AI assistants
}

// ─── Transition ───────────────────────────────────────────────────────────────

export interface ImportReviewTransition {
  id:            string;
  stagingItemId: string;
  fromState:     ReviewState;
  toState:       ReviewState;
  actor:         ReviewActor;
  reason?:       string;
  metadata?:     Record<string, unknown>;
  occurredAt:    string; // ISO 8601
}

// ─── Transition table ─────────────────────────────────────────────────────────

export const REVIEW_TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  extracted:      ["normalized", "rejected"],
  normalized:     ["review_pending", "rejected"],
  review_pending: ["reviewed", "approved", "rejected", "corrected"],
  reviewed:       ["approved", "rejected", "corrected"],
  approved:       ["catmat_linked", "finalized"],
  rejected:       [],                              // terminal — irreversível
  corrected:      ["review_pending", "approved"],  // após correção pode voltar para revisão
  catmat_linked:  ["finalized"],
  finalized:      [],                              // terminal
};

export function isValidReviewTransition(from: ReviewState, to: ReviewState): boolean {
  return REVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalReviewState(state: ReviewState): boolean {
  return state === "rejected" || state === "finalized";
}

export function isHumanActionRequired(state: ReviewState): boolean {
  return state === "review_pending" || state === "reviewed";
}

export function canAutoAdvance(state: ReviewState): boolean {
  return state === "extracted" || state === "normalized";
}

// ─── Guard ────────────────────────────────────────────────────────────────────

export interface ReviewTransitionGuard {
  canTransition: boolean;
  reason?:       string;
}

export function guardReviewTransition(
  current:  ReviewState,
  next:     ReviewState,
  actor:    ReviewActor,
): ReviewTransitionGuard {
  if (!isValidReviewTransition(current, next)) {
    return {
      canTransition: false,
      reason: `Transição inválida: ${current} → ${next}`,
    };
  }

  // Aprovação e rejeição requerem ator humano ou AI assistida
  if ((next === "approved" || next === "corrected") && actor.type === "system") {
    return {
      canTransition: false,
      reason: `Aprovação/correção exige ator humano ou ai_assist, não system`,
    };
  }

  // finalized apenas via system (consolidação automática após aprovação)
  if (next === "finalized" && actor.type === "human") {
    return {
      canTransition: false,
      reason: `Finalização é operação de sistema, não manual`,
    };
  }

  return { canTransition: true };
}

// ─── History builder ──────────────────────────────────────────────────────────

import { nanoid } from "nanoid";

export function buildReviewTransition(
  stagingItemId: string,
  from:          ReviewState,
  to:            ReviewState,
  actor:         ReviewActor,
  reason?:       string,
  metadata?:     Record<string, unknown>,
): ImportReviewTransition {
  return {
    id:            nanoid(),
    stagingItemId,
    fromState:     from,
    toState:       to,
    actor,
    reason,
    metadata,
    occurredAt:    new Date().toISOString(),
  };
}

// ─── Current state from history ───────────────────────────────────────────────

export function currentStateFromHistory(
  history: ImportReviewTransition[],
  initial: ReviewState = "extracted",
): ReviewState {
  if (history.length === 0) return initial;
  const sorted = [...history].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt),
  );
  return sorted[sorted.length - 1].toState;
}

export function lastTransitionBy(
  history: ImportReviewTransition[],
  actorType: ReviewActorType,
): ImportReviewTransition | null {
  const filtered = history
    .filter(t => t.actor.type === actorType)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return filtered[0] ?? null;
}
