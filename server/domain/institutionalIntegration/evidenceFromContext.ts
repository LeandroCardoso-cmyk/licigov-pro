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

/**
 * VIGÊNCIA NORMATIVA — status jurídicos que permitem uma NORMA fundamentar uma contratação ATUAL. NÃO
 * inclui "publicado": publicação editorial não é vigência jurídica (uma norma revogada pode ter sido
 * publicada). Usado para âncoras LEGAIS (art./§/inciso) e validação de citações normativas.
 */
const NORMATIVE_CURRENT = new Set(["vigente", "parcialmente_vigente"]);

/**
 * DISPONIBILIDADE de fonte COMPLEMENTAR (manual/orientação/jurisprudência) — inclui "publicado"
 * (disponibilidade editorial/consulta). Uma fonte complementar NÃO é norma jurídica: pode ser evidência
 * de apoio, mas não satisfaz uma âncora legal (isso é decidido pela qualidade da fonte, não só pelo status).
 */
const SUPPLEMENTAL_AVAILABLE = new Set(["vigente", "parcialmente_vigente", "publicado"]);

/** VIGÊNCIA NORMATIVA: a norma está juridicamente vigente para fundamentar? (temporalidade — REGRA CONGELADA). */
export function isNormativeCurrent(status: string | undefined | null): boolean {
  return NORMATIVE_CURRENT.has((status ?? "").trim().toLowerCase());
}

/** DISPONIBILIDADE de fonte complementar (inclui publicado). NÃO promove a fonte a norma vigente. */
export function isSupplementalAvailable(status: string | undefined | null): boolean {
  return SUPPLEMENTAL_AVAILABLE.has((status ?? "").trim().toLowerCase());
}

/**
 * @deprecated Semântica ambígua. Prefira `isNormativeCurrent` (âncora legal) ou `isSupplementalAvailable`
 * (fonte complementar). Mantido para coleta genérica de evidência (fingerprint/lineage), onde exclui
 * apenas fontes revogadas/históricas/desconhecidas.
 */
export function isCurrentStatus(status: string | undefined | null): boolean {
  return isSupplementalAvailable(status);
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
    // Gap 7 — SEM fallback: status ausente/desconhecido NÃO vira evidência (nunca inferido como vigente);
    // fonte revogada/histórica também é excluída.
    .filter((p) => status.has(p.normId) && isCurrentStatus(status.get(p.normId)))
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
