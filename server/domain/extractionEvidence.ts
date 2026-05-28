/**
 * Sprint 2.9 — Extraction Evidence.
 *
 * Rastreabilidade jurídica de cada campo extraído.
 * Cada decisão do sistema (normalização, vínculo, aprovação) deve ter evidência.
 * Princípio: explainability completa para auditoria e contestação.
 */

import { nanoid } from "nanoid";
import type { ExtractionProvenance } from "./importProvenance";

// ─── Evidence types ───────────────────────────────────────────────────────────

export type EvidenceType =
  | "raw_extraction"    // valor extraído diretamente do arquivo
  | "unit_normalization"// unidade normalizada via CanonicalUnits
  | "quantity_parse"    // quantidade parseada de string bruta
  | "price_parse"       // preço parseado (tratamento de locale)
  | "description_clean" // descrição limpa (remoção de ruído)
  | "catmat_match"      // vínculo com item CATMAT/CATSER
  | "human_correction"  // correção manual pelo revisor
  | "ai_suggestion"     // sugestão da camada de AI
  | "duplicate_merge"   // item fundido com duplicata detectada
  | "rule_inference";   // inferência por regra de negócio

export type EvidenceStrength =
  | "definitive"   // evidência conclusiva, sem ambiguidade
  | "strong"       // evidência forte, pouca incerteza
  | "moderate"     // evidência razoável, alguma incerteza
  | "weak"         // evidência fraca, alta incerteza
  | "speculative"; // evidência especulativa, requer verificação

// ─── Evidence chain entry ─────────────────────────────────────────────────────

export interface EvidenceEntry {
  id:           string;
  type:         EvidenceType;
  strength:     EvidenceStrength;
  field:        string;             // campo ao qual se refere (ex: "unit", "quantity")
  originalValue: string | null;     // valor antes da transformação
  resultValue:  string | null;      // valor após a transformação
  rationale:    string;             // explicação legível por humanos
  confidence:   number;             // 0–1
  sourceRef?:   string;             // referência à fonte (ex: "CATMAT:123456")
  ruleCode?:    string;             // código da regra aplicada
  occurredAt:   string;             // ISO 8601
}

// ─── Extraction evidence aggregate ───────────────────────────────────────────

export interface ExtractionEvidence {
  stagingItemId: string;
  importSessionId: number;
  organizationId:  number;
  provenance:      ExtractionProvenance;
  chain:           EvidenceEntry[];  // histórico imutável de transformações
  createdAt:       string;
  updatedAt:       string;
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function createExtractionEvidence(
  stagingItemId:   string,
  importSessionId: number,
  organizationId:  number,
  provenance:      ExtractionProvenance,
): ExtractionEvidence {
  const now = new Date().toISOString();
  return {
    stagingItemId,
    importSessionId,
    organizationId,
    provenance,
    chain:     [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addEvidenceEntry(
  evidence: ExtractionEvidence,
  entry:    Omit<EvidenceEntry, "id" | "occurredAt">,
): ExtractionEvidence {
  const newEntry: EvidenceEntry = {
    ...entry,
    id:         nanoid(),
    occurredAt: new Date().toISOString(),
  };
  return {
    ...evidence,
    chain:     [...evidence.chain, newEntry],
    updatedAt: newEntry.occurredAt,
  };
}

export function buildRawExtractionEvidence(
  field:    string,
  rawValue: string | null,
  confidence: number,
): Omit<EvidenceEntry, "id" | "occurredAt"> {
  return {
    type:          "raw_extraction",
    strength:      confidence >= 0.85 ? "definitive" : confidence >= 0.60 ? "strong" : "moderate",
    field,
    originalValue: null,
    resultValue:   rawValue,
    rationale:     `Valor extraído diretamente do arquivo-fonte (confiança: ${(confidence * 100).toFixed(0)}%)`,
    confidence,
  };
}

export function buildUnitNormalizationEvidence(
  rawUnit:       string | null,
  canonicalUnit: string | null,
  matchSource:   string,
  confidence:    number,
): Omit<EvidenceEntry, "id" | "occurredAt"> {
  const strength: EvidenceStrength =
    matchSource === "exact"  ? "definitive" :
    matchSource === "alias"  ? "strong" :
    matchSource === "fuzzy"  ? "moderate" :
    matchSource === "prefix" ? "weak" : "speculative";

  return {
    type:          "unit_normalization",
    strength,
    field:         "unit",
    originalValue: rawUnit,
    resultValue:   canonicalUnit,
    rationale:     `Unidade normalizada via ${matchSource}: "${rawUnit}" → "${canonicalUnit}"`,
    confidence,
    ruleCode:      `UNIT_NORM_${matchSource.toUpperCase()}`,
  };
}

export function buildHumanCorrectionEvidence(
  field:         string,
  originalValue: string | null,
  correctedValue: string | null,
  userId:        number,
  rationale:     string,
): Omit<EvidenceEntry, "id" | "occurredAt"> {
  return {
    type:          "human_correction",
    strength:      "definitive",
    field,
    originalValue,
    resultValue:   correctedValue,
    rationale:     `Correção manual por userId=${userId}: ${rationale}`,
    confidence:    1.0,
    ruleCode:      "HUMAN_OVERRIDE",
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getEvidenceByField(
  evidence: ExtractionEvidence,
  field:    string,
): EvidenceEntry[] {
  return evidence.chain.filter(e => e.field === field);
}

export function getLastTransformationFor(
  evidence: ExtractionEvidence,
  field:    string,
): EvidenceEntry | null {
  // Use last-in-chain ordering (preserves append order, stable across same-millisecond calls)
  const entries = evidence.chain.filter(e => e.field === field);
  if (entries.length === 0) return null;
  return entries[entries.length - 1];
}

export function hasHumanOverride(evidence: ExtractionEvidence, field: string): boolean {
  return getEvidenceByField(evidence, field).some(e => e.type === "human_correction");
}

export function evidenceSummary(evidence: ExtractionEvidence): {
  totalTransformations: number;
  humanOverrides:       number;
  aiSuggestions:        number;
  avgConfidence:        number;
} {
  const chain = evidence.chain;
  const avgConfidence = chain.length > 0
    ? chain.reduce((s, e) => s + e.confidence, 0) / chain.length
    : 0;
  return {
    totalTransformations: chain.length,
    humanOverrides:       chain.filter(e => e.type === "human_correction").length,
    aiSuggestions:        chain.filter(e => e.type === "ai_suggestion").length,
    avgConfidence,
  };
}
