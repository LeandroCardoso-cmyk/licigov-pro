/**
 * Sprint 3.0 — ItemTR Aggregate Root.
 *
 * Representa um item consolidado do Termo de Referência (TR), promovido do
 * staging de importação ao domínio. Carrega candidatos semânticos, consenso,
 * vínculo CATMAT/CATSER, estado de revisão, proveniência e evidências.
 *
 * PRINCÍPIOS:
 *   - Toda mutação retorna um NOVO objeto imutável (nunca muta in-place).
 *   - Identidade determinística: mesmo (org+process+itemNumber+source) → mesmo id.
 *   - Aprovação/override exigem ator humano (delegado a itemReviewWorkflow).
 *   - Proveniência e linhagem de candidatos preservadas em todas as transições.
 *   - Replay-safe: reconstrução do ciclo de vida é determinística.
 *
 * Embasamento: princípio do planejamento e da segregação de funções
 * (Lei 14.133/2021, arts. 6º e 18).
 */

import { createHash } from "crypto";
import type { SemanticCandidate } from "./semanticCandidate";
import type { CandidateConsensus } from "./candidateConsensus";
import type { ExtractionProvenance } from "./importProvenance";
import { scoreToLevel } from "./importConfidence";
import {
  type ItemReviewState,
  type ItemReviewHistory,
  type ItemReviewTransition,
  buildItemReviewTransition,
  appendItemReviewTransition,
  guardItemReviewTransition,
  currentItemStateFromHistory,
} from "./itemReviewWorkflow";
import type { ReviewActor } from "./importReviewState";

// ─── ItemTR aggregate ───────────────────────────────────────────────────────

export interface ItemTR {
  id:                     string;
  organizationId:         number;
  processId:              number;
  sourceImportSessionId:  number | null;

  itemNumber:             number;
  description:            string;
  normalizedDescription:  string;
  detailedSpecification:  string | null;

  quantity:               number;
  unit:                   string;
  canonicalUnit:          string | null;

  estimatedUnitPrice:     number | null;
  estimatedTotalPrice:    number | null;

  catmatCode:             string | null;
  catmatDescription:      string | null;
  catserCode:             string | null;

  semanticCandidates:     SemanticCandidate[];
  selectedCandidate:      SemanticCandidate | null;
  candidateConsensus:     CandidateConsensus | null;
  confidenceScore:        number;

  reviewState:            ItemReviewState;
  reviewHistory:          ItemReviewHistory;
  approvedBy:             number | null;
  approvedAt:             string | null;

  provenance:             ExtractionProvenance;
  evidenceRef:            string | null;

  warnings:               string[];
  metadata:               Record<string, unknown>;

  createdAt:              string; // ISO 8601
  updatedAt:              string; // ISO 8601
}

// ─── Deterministic identity ───────────────────────────────────────────────────

/**
 * Computa um id determinístico a partir de (org, process, itemNumber, source).
 * Mesmos inputs → mesmo id sempre (replay-safe).
 */
export function computeItemTRId(
  organizationId:        number,
  processId:             number,
  itemNumber:            number,
  sourceImportSessionId: number | null,
): string {
  const seed = JSON.stringify({
    itemNumber,
    organizationId,
    processId,
    sourceImportSessionId: sourceImportSessionId ?? null,
  });
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CreateItemTRParams {
  organizationId:         number;
  processId:              number;
  itemNumber:             number;
  description:            string;
  unit:                   string;
  quantity:               number;
  provenance:             ExtractionProvenance;
  sourceImportSessionId?: number | null;
  normalizedDescription?: string;
  detailedSpecification?: string | null;
  canonicalUnit?:         string | null;
  estimatedUnitPrice?:    number | null;
  catmatCode?:            string | null;
  catmatDescription?:     string | null;
  catserCode?:            string | null;
  semanticCandidates?:    SemanticCandidate[];
  candidateConsensus?:    CandidateConsensus | null;
  confidenceScore?:       number;
  evidenceRef?:           string | null;
  warnings?:              string[];
  metadata?:              Record<string, unknown>;
}

export function createItemTR(params: CreateItemTRParams): ItemTR {
  const now = new Date().toISOString();
  const sourceImportSessionId = params.sourceImportSessionId ?? null;
  const id = computeItemTRId(
    params.organizationId,
    params.processId,
    params.itemNumber,
    sourceImportSessionId,
  );

  const quantity = params.quantity;
  const estimatedUnitPrice = params.estimatedUnitPrice ?? null;
  const estimatedTotalPrice =
    estimatedUnitPrice != null ? round2(estimatedUnitPrice * quantity) : null;

  return {
    id,
    organizationId:        params.organizationId,
    processId:             params.processId,
    sourceImportSessionId,
    itemNumber:            params.itemNumber,
    description:           params.description,
    normalizedDescription: params.normalizedDescription ?? params.description,
    detailedSpecification: params.detailedSpecification ?? null,
    quantity,
    unit:                  params.unit,
    canonicalUnit:         params.canonicalUnit ?? null,
    estimatedUnitPrice,
    estimatedTotalPrice,
    catmatCode:            params.catmatCode ?? null,
    catmatDescription:     params.catmatDescription ?? null,
    catserCode:            params.catserCode ?? null,
    semanticCandidates:    params.semanticCandidates ?? [],
    selectedCandidate:     null,
    candidateConsensus:    params.candidateConsensus ?? null,
    confidenceScore:       clamp01(params.confidenceScore ?? 0),
    reviewState:           "pending_match",
    reviewHistory:         [],
    approvedBy:            null,
    approvedAt:            null,
    provenance:            params.provenance,
    evidenceRef:           params.evidenceRef ?? null,
    warnings:              params.warnings ? [...params.warnings] : [],
    metadata:              params.metadata ? { ...params.metadata } : {},
    createdAt:             now,
    updatedAt:             now,
  };
}

// ─── State transition helper ──────────────────────────────────────────────────

function transition(
  item:   ItemTR,
  to:     ItemReviewState,
  actor:  ReviewActor,
  params: {
    reason?:        string;
    justification?: string;
    evidenceRefs?:  string[];
    metadata?:      Record<string, unknown>;
  } = {},
): ItemReviewTransition {
  const from = item.reviewState;
  const guard = guardItemReviewTransition(from, to, actor, { history: item.reviewHistory });
  if (!guard.canTransition) {
    throw new Error(guard.reason ?? `Transição inválida: ${from} → ${to}`);
  }
  return buildItemReviewTransition(item.id, from, to, actor, params);
}

function applyTransition(item: ItemTR, t: ItemReviewTransition): ItemTR {
  const history = appendItemReviewTransition(item.reviewHistory, t);
  return {
    ...item,
    reviewState:   currentItemStateFromHistory(history, "pending_match"),
    reviewHistory: history,
    updatedAt:     t.occurredAt,
  };
}

// ─── Candidate selection ──────────────────────────────────────────────────────

/**
 * Seleciona um candidato pelo id, vinculando CATMAT/CATSER e atualizando confiança.
 * Avança o estado para "candidate_generated" → "awaiting_review" quando aplicável.
 * Retorna um NOVO objeto imutável.
 */
export function selectCandidate(
  item:        ItemTR,
  candidateId: string,
  actor:       ReviewActor,
): ItemTR {
  const candidate = item.semanticCandidates.find(c => c.id === candidateId) ?? null;
  if (!candidate) {
    throw new Error(`Candidato "${candidateId}" não encontrado neste ItemTR.`);
  }

  let next: ItemTR = {
    ...item,
    selectedCandidate:  candidate,
    catmatCode:         candidate.catmatCode ?? item.catmatCode,
    catmatDescription:  candidate.catmatDesc ?? item.catmatDescription,
    confidenceScore:    candidate.score,
    updatedAt:          new Date().toISOString(),
  };

  // Avança o ciclo de vida de revisão de forma defensiva.
  if (next.reviewState === "pending_match") {
    const t1 = transition(next, "candidate_generated", actor);
    next = applyTransition(next, t1);
  }
  if (next.reviewState === "candidate_generated") {
    const t2 = transition(next, "awaiting_review", actor);
    next = applyTransition(next, t2);
  }
  return next;
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export function approveItem(
  item:  ItemTR,
  actor: ReviewActor,
  params: { reason?: string; evidenceRefs?: string[] } = {},
): ItemTR {
  const t = transition(item, "approved", actor, params);
  const applied = applyTransition(item, t);
  return {
    ...applied,
    approvedBy: actor.userId ?? null,
    approvedAt: t.occurredAt,
  };
}

// ─── Rejection ────────────────────────────────────────────────────────────────

export function rejectItem(
  item:   ItemTR,
  actor:  ReviewActor,
  reason: string,
  params: { evidenceRefs?: string[] } = {},
): ItemTR {
  const t = transition(item, "rejected", actor, {
    reason,
    evidenceRefs: params.evidenceRefs,
  });
  return applyTransition(item, t);
}

// ─── Override ─────────────────────────────────────────────────────────────────

export interface OverrideValue {
  description?:           string;
  normalizedDescription?: string;
  detailedSpecification?: string | null;
  unit?:                  string;
  canonicalUnit?:         string | null;
  quantity?:              number;
  estimatedUnitPrice?:    number | null;
  catmatCode?:            string | null;
  catmatDescription?:     string | null;
  catserCode?:            string | null;
}

/**
 * Sobrescreve campos do item manualmente. Exige justificativa (mín. 5 chars,
 * validada por buildItemReviewTransition). Recalcula totais. Imutável.
 */
export function overrideItem(
  item:          ItemTR,
  actor:         ReviewActor,
  value:         OverrideValue,
  justification: string,
  params: { evidenceRefs?: string[] } = {},
): ItemTR {
  const t = transition(item, "overridden", actor, {
    justification,
    evidenceRefs: params.evidenceRefs,
    metadata:     { overriddenFields: Object.keys(value) },
  });
  let applied = applyTransition(item, t);

  applied = {
    ...applied,
    description:           value.description           ?? applied.description,
    normalizedDescription: value.normalizedDescription ?? applied.normalizedDescription,
    detailedSpecification: value.detailedSpecification !== undefined
      ? value.detailedSpecification
      : applied.detailedSpecification,
    unit:                  value.unit                  ?? applied.unit,
    canonicalUnit:         value.canonicalUnit !== undefined
      ? value.canonicalUnit
      : applied.canonicalUnit,
    quantity:              value.quantity              ?? applied.quantity,
    estimatedUnitPrice:    value.estimatedUnitPrice !== undefined
      ? value.estimatedUnitPrice
      : applied.estimatedUnitPrice,
    catmatCode:            value.catmatCode !== undefined ? value.catmatCode : applied.catmatCode,
    catmatDescription:     value.catmatDescription !== undefined
      ? value.catmatDescription
      : applied.catmatDescription,
    catserCode:            value.catserCode !== undefined ? value.catserCode : applied.catserCode,
  };

  return recomputeTotals(applied);
}

// ─── Manual entry ─────────────────────────────────────────────────────────────

/**
 * Marca o item como entrada manual (sem candidatos). Estado → manual_entry.
 */
export function markManualEntry(item: ItemTR, actor: ReviewActor): ItemTR {
  const t = transition(item, "manual_entry", actor);
  return applyTransition(item, t);
}

// ─── Finalization ─────────────────────────────────────────────────────────────

export function finalizeItem(item: ItemTR, actor: ReviewActor): ItemTR {
  const t = transition(item, "finalized", actor);
  return applyTransition(item, t);
}

// ─── Warnings ─────────────────────────────────────────────────────────────────

export function addWarning(item: ItemTR, warning: string): ItemTR {
  if (item.warnings.includes(warning)) return item;
  return {
    ...item,
    warnings:  [...item.warnings, warning],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Totals ───────────────────────────────────────────────────────────────────

/**
 * Recalcula estimatedTotalPrice = estimatedUnitPrice * quantity.
 * Determinístico, imutável.
 */
export function recomputeTotals(item: ItemTR): ItemTR {
  const total =
    item.estimatedUnitPrice != null
      ? round2(item.estimatedUnitPrice * item.quantity)
      : null;
  if (total === item.estimatedTotalPrice) return item;
  return {
    ...item,
    estimatedTotalPrice: total,
    updatedAt:           new Date().toISOString(),
  };
}

// ─── Confidence helpers ───────────────────────────────────────────────────────

export function itemConfidenceLevel(item: ItemTR): ReturnType<typeof scoreToLevel> {
  return scoreToLevel(item.confidenceScore);
}

export function attachConsensus(
  item:      ItemTR,
  consensus: CandidateConsensus,
): ItemTR {
  return {
    ...item,
    candidateConsensus: consensus,
    confidenceScore:    consensus.consensusScore,
    updatedAt:          new Date().toISOString(),
  };
}

// ─── Numeric helpers ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
