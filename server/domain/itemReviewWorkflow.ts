/**
 * Sprint 3.0 — Item Review Workflow.
 *
 * Máquina de estados para revisão de ItemTR (item consolidado do Termo de Referência).
 * Diferente de importReviewState (que cobre o staging de importação), esta máquina
 * cobre o ciclo de vida do item já promovido ao domínio: geração de candidatos,
 * revisão humana, aprovação, override e finalização.
 *
 * PRINCÍPIOS:
 *   - Toda transição é imutável e auditável (append-only history).
 *   - Aprovação/override exigem ator humano (system jamais aprova sozinho).
 *   - Finalização exige estado prévio approved ou overridden.
 *   - Override exige justificativa (mín. 5 caracteres).
 *   - Replay-safe: reconstrução do estado a partir do histórico é determinística.
 *
 * Embasamento: princípio do controle e da segregação de funções (Lei 14.133/2021).
 */

import { nanoid } from "nanoid";
import type { ReviewActor } from "./importReviewState";

// ─── States ───────────────────────────────────────────────────────────────────

export type ItemReviewState =
  | "pending_match"        // item aguardando geração de candidatos
  | "candidate_generated"  // candidatos semânticos gerados
  | "awaiting_review"      // aguardando decisão humana
  | "approved"             // aprovado por revisor humano
  | "rejected"             // rejeitado (descartado deste TR)
  | "overridden"           // valor sobrescrito manualmente pelo revisor
  | "manual_entry"         // item inserido manualmente (sem candidatos)
  | "finalized";           // consolidado no TR final

// ─── Transition table ─────────────────────────────────────────────────────────

export const ITEM_REVIEW_TRANSITIONS: Record<ItemReviewState, ItemReviewState[]> = {
  pending_match:       ["candidate_generated", "manual_entry", "rejected"],
  candidate_generated: ["awaiting_review", "rejected"],
  awaiting_review:     ["approved", "rejected", "overridden"],
  manual_entry:        ["awaiting_review", "approved", "rejected", "overridden"],
  approved:            ["finalized", "overridden"],
  overridden:          ["finalized", "approved"],
  rejected:            [],            // terminal
  finalized:           [],            // terminal
};

export function isValidItemReviewTransition(
  from: ItemReviewState,
  to:   ItemReviewState,
): boolean {
  return ITEM_REVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalItemReviewState(state: ItemReviewState): boolean {
  return state === "rejected" || state === "finalized";
}

// ─── Override justification rule ──────────────────────────────────────────────

export const MIN_OVERRIDE_JUSTIFICATION_LENGTH = 5;

export function assertOverrideJustification(justification: string): void {
  if (!justification || justification.trim().length < MIN_OVERRIDE_JUSTIFICATION_LENGTH) {
    throw new Error(
      `Override exige justificativa com no mínimo ${MIN_OVERRIDE_JUSTIFICATION_LENGTH} caracteres.`,
    );
  }
}

// ─── Guard ────────────────────────────────────────────────────────────────────

export interface ItemReviewTransitionGuard {
  canTransition: boolean;
  reason?:       string;
}

export function guardItemReviewTransition(
  from:    ItemReviewState,
  to:      ItemReviewState,
  actor:   ReviewActor,
  context: { history?: ItemReviewHistory } = {},
): ItemReviewTransitionGuard {
  if (!isValidItemReviewTransition(from, to)) {
    return {
      canTransition: false,
      reason: `Transição inválida: ${from} → ${to}`,
    };
  }

  // Aprovação e override exigem ator humano — system jamais aprova.
  if ((to === "approved" || to === "overridden") && actor.type === "system") {
    return {
      canTransition: false,
      reason: `Aprovação/override exige ator humano (ou ai_assist supervisionado), nunca system.`,
    };
  }

  // Finalização exige que o item tenha passado por approved ou overridden.
  if (to === "finalized") {
    const history = context.history ?? [];
    const states = new Set<ItemReviewState>(history.map(t => t.toState));
    states.add(from);
    if (!states.has("approved") && !states.has("overridden")) {
      return {
        canTransition: false,
        reason: `Finalização exige estado prévio "approved" ou "overridden".`,
      };
    }
  }

  return { canTransition: true };
}

// ─── Transition + history ─────────────────────────────────────────────────────

export interface ItemReviewTransition {
  id:        string;
  itemId:    string;
  fromState: ItemReviewState;
  toState:   ItemReviewState;
  actor:     ReviewActor;
  reason?:   string;
  /** Justificativa obrigatória em override. */
  justification?: string;
  /** Referências a evidências que embasaram a decisão. */
  evidenceRefs:   string[];
  metadata?: Record<string, unknown>;
  occurredAt: string; // ISO 8601
}

/** Histórico imutável (append-only). */
export type ItemReviewHistory = ItemReviewTransition[];

export function buildItemReviewTransition(
  itemId: string,
  from:   ItemReviewState,
  to:     ItemReviewState,
  actor:  ReviewActor,
  params: {
    reason?:        string;
    justification?: string;
    evidenceRefs?:  string[];
    metadata?:      Record<string, unknown>;
  } = {},
): ItemReviewTransition {
  // Override exige justificativa válida.
  if (to === "overridden") {
    assertOverrideJustification(params.justification ?? "");
  }

  return {
    id:            nanoid(),
    itemId,
    fromState:     from,
    toState:       to,
    actor,
    reason:        params.reason,
    justification: params.justification,
    evidenceRefs:  params.evidenceRefs ?? [],
    metadata:      params.metadata,
    occurredAt:    new Date().toISOString(),
  };
}

/** Anexa uma transição ao histórico, retornando um NOVO array imutável. */
export function appendItemReviewTransition(
  history:    ItemReviewHistory,
  transition: ItemReviewTransition,
): ItemReviewHistory {
  return [...history, transition];
}

// ─── State reconstruction ─────────────────────────────────────────────────────

export function currentItemStateFromHistory(
  history: ItemReviewHistory,
  initial: ItemReviewState = "pending_match",
): ItemReviewState {
  if (history.length === 0) return initial;
  // Array é append-only — o último elemento é sempre a transição mais recente.
  // Ordenar por occurredAt é não-determinístico quando duas transições ocorrem
  // no mesmo milissegundo (ex: os dois passos dentro de selectCandidate).
  return history[history.length - 1].toState;
}

export function lastItemTransitionBy(
  history:   ItemReviewHistory,
  actorType: ReviewActor["type"],
): ItemReviewTransition | null {
  const filtered = history
    .filter(t => t.actor.type === actorType)
    .sort((a, b) => {
      const t = b.occurredAt.localeCompare(a.occurredAt);
      return t !== 0 ? t : b.id.localeCompare(a.id);
    });
  return filtered[0] ?? null;
}
