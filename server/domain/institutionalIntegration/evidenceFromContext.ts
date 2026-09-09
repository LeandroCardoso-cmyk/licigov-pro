/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — Ponte ContextPackage → EvidenceRef (A1) (domínio PURO).
 *
 * Converte as PASSAGENS REAIS recuperadas (ContextPackage do pipeline institucional) em
 * `EvidenceRef[]` da A1 (sourceId + locator canônico + contentHash), calcula o estado de grounding
 * FACTUAL (grounded/partially_grounded/ungrounded) por uma regra determinística de cobertura, e um
 * fingerprint determinístico do CORPUS efetivamente usado (lineage/reprodutibilidade). Só passagens
 * de fontes VIGENTES contam como evidência (temporalidade — fonte revogada/histórica não fundamenta).
 */

import { createHash } from "crypto";
import {
  evidenceRef, computeEvidenceFingerprint, deriveGroundingState,
  type EvidenceRef, type GroundingState,
} from "../cognitiveProvenance";
import { canonicalLocatorId } from "./canonicalLocator";
import type { ContextPackage, ContextDocument } from "./contextPackage";

/** Status temporais que PERMITEM uso como fundamento atual (fonte revogada/histórica é excluída). */
const CURRENT_STATUSES = new Set(["vigente", "parcialmente_vigente", "publicado"]);

/** Um status é utilizável como fundamento atual? (temporalidade — REGRA CONGELADA A2). */
export function isCurrentStatus(status: string | undefined | null): boolean {
  return CURRENT_STATUSES.has((status ?? "").trim().toLowerCase());
}

export interface GroundingAssessment {
  readonly evidences: readonly EvidenceRef[];
  readonly evidenceCount: number;
  readonly evidenceComplete: boolean;
  readonly groundingState: GroundingState;
  readonly evidenceFingerprint: string | null;
  /** Fingerprint determinístico do corpus (fontes) que sustentou a execução — lineage, não conteúdo. */
  readonly corpusFingerprint: string;
  /** normIds das fontes VIGENTES efetivamente usadas (auditoria). */
  readonly usedSourceIds: readonly string[];
}

/** Mapa normId → status (das fontes do ContextPackage). */
function statusByNormId(documents: readonly ContextDocument[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of documents) m.set(d.normId, d.status);
  return m;
}

/**
 * Constrói EvidenceRef[] reais a partir das passagens recuperadas — SOMENTE de fontes vigentes.
 * sourceId = normId; locator = locator canônico estável; contentHash = sha256 do texto verbatim.
 */
export function evidenceRefsFromContextPackage(pkg: ContextPackage): EvidenceRef[] {
  const status = statusByNormId(pkg.documents);
  return pkg.retrievedPassages
    .filter((p) => isCurrentStatus(status.get(p.normId) ?? "vigente")) // fonte revogada não vira evidência
    .map((p) => evidenceRef(p.normId, canonicalLocatorId(p.normId, p.identifier), p.text));
}

/** Fingerprint determinístico do corpus usado (sourceId@version#status ordenado). */
export function corpusFingerprintOfDocuments(documents: readonly ContextDocument[]): string {
  const norm = [...new Set(documents.map((d) => `${d.normId}@${d.version}#${d.status}`))].sort();
  if (norm.length === 0) return createHash("sha256").update("corpus:empty").digest("hex");
  return createHash("sha256").update(`corpus:${norm.join("|")}`).digest("hex");
}

/**
 * Avalia o grounding FACTUAL de um ContextPackage segundo uma regra determinística:
 *   - evidências reais (passagens de fontes vigentes) → EvidenceRef[];
 *   - `evidenceComplete` = há ao menos `minEvidences` evidências reais E cobertura ≥ `minCoverage`;
 *   - groundingState: reusa a semântica honesta da A1 (grounded só com evidência real; completa/incompleta).
 * NÃO usa confidence do LLM. NÃO fabrica evidência.
 */
export function assessGrounding(pkg: ContextPackage, policy: { minEvidences: number; minCoverage: number }): GroundingAssessment {
  const evidences = evidenceRefsFromContextPackage(pkg);
  const evidenceCount = evidences.length;
  const coverageRatio = Number((pkg.metadata as { coverageRatio?: unknown })?.coverageRatio ?? 0);
  const evidenceComplete = evidenceCount >= Math.max(1, policy.minEvidences) && coverageRatio >= policy.minCoverage;
  const groundingState = deriveGroundingState({ usesGrounding: true, usesRAG: true, evidenceCount, evidenceComplete });
  const evidenceFingerprint = evidenceCount > 0 ? computeEvidenceFingerprint(evidences) : null;
  const usedSourceIds = [...new Set(evidences.map((e) => e.sourceId))].sort();
  return {
    evidences, evidenceCount, evidenceComplete, groundingState, evidenceFingerprint,
    corpusFingerprint: corpusFingerprintOfDocuments(pkg.documents), usedSourceIds,
  };
}
