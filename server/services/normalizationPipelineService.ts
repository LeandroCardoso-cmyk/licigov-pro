/**
 * Sprint 2.9 — Normalization Pipeline Service.
 *
 * Pipeline de 7 estágios para normalização de itens extraídos:
 *   Stage 1: raw       — valida e sanitiza campos brutos
 *   Stage 2: lexical   — limpeza lexical de descrição (remoção de ruído)
 *   Stage 3: unit      — normalização de unidade via CanonicalUnits
 *   Stage 4: quantity  — parse de quantidade com locale PT-BR
 *   Stage 5: price     — parse de preços unitário/total
 *   Stage 6: semantic  — geração de candidatos semânticos via SemanticIndex
 *   Stage 7: prep      — preparação para revisão humana
 *
 * Cada estágio é idempotente e isolado.
 * Falha em qualquer estágio é reportada mas não interrompe o pipeline
 * (exceto erros fatais de validação no Stage 1).
 */

import type { RawExtractedItem }    from "../domain/importExtraction";
import type { ExtractionEvidence }  from "../domain/extractionEvidence";
import type { SemanticCandidate }   from "../domain/semanticCandidate";
import { normalizeUnit }            from "../domain/canonicalUnits";
import {
  addEvidenceEntry,
  buildRawExtractionEvidence,
  buildUnitNormalizationEvidence,
  createExtractionEvidence,
} from "../domain/extractionEvidence";
import {
  buildCandidateSet,
  buildExplanation,
  createSemanticCandidate,
  type CandidateSet,
} from "../domain/semanticCandidate";
import {
  globalSemanticIndex,
  tokenize,
} from "../domain/semanticIndex";
import { scoreToLevel } from "../domain/importConfidence";

// ─── Stage result ─────────────────────────────────────────────────────────────

export type StageStatus = "ok" | "warning" | "skipped" | "failed";

export interface StageResult {
  stage:      number;
  name:       string;
  status:     StageStatus;
  durationMs: number;
  warnings:   string[];
  errors:     string[];
}

// ─── Normalized item (output of pipeline) ────────────────────────────────────

export interface NormalizedItem {
  stagingItemId:    string;
  importSessionId:  number;
  organizationId:   number;

  // Campos normalizados
  description:      string | null;
  canonicalUnit:    string | null;
  unitMatchSource:  string | null;   // "exact"|"alias"|"fuzzy"|"prefix"
  quantity:         number | null;
  unitPrice:        number | null;
  totalPrice:       number | null;

  // Qualidade
  overallConfidence: number;
  requiresReview:    boolean;
  reviewFlags:       string[];

  // Candidatos semânticos
  candidateSet:     CandidateSet;

  // Rastreabilidade
  evidence:         ExtractionEvidence;

  // Métricas do pipeline
  stageResults:     StageResult[];
  totalDurationMs:  number;
  pipelineVersion:  string;
}

// ─── Pipeline options ─────────────────────────────────────────────────────────

export interface PipelineOptions {
  organizationId:    number;
  maxCandidates?:    number;  // default 5
  minCandidateScore?: number; // default 0.35
  skipSemanticStage?: boolean;
  strictPriceCheck?:  boolean;
}

const PIPELINE_VERSION = "2.9.0";

// ─── Stage implementations ────────────────────────────────────────────────────

function stageRaw(
  item:     RawExtractedItem,
  evidence: ExtractionEvidence,
): { ok: boolean; flags: string[]; evidence: ExtractionEvidence } {
  const flags: string[] = [];
  let ev = evidence;

  if (!item.rawDescription || item.rawDescription.trim().length === 0) {
    flags.push("MISSING_DESCRIPTION");
  }

  // Add raw extraction evidence for each field
  const fields: Array<[string, string | null, number]> = [
    ["description", item.rawDescription, item.confidenceMetadata.fieldConfidences.find(f => f.field === "description")?.score ?? 0.5],
    ["unit",        item.rawUnit,         item.confidenceMetadata.fieldConfidences.find(f => f.field === "unit")?.score ?? 0.5],
    ["quantity",    item.rawQuantity,     item.confidenceMetadata.fieldConfidences.find(f => f.field === "quantity")?.score ?? 0.5],
    ["unit_price",  item.rawUnitPrice,    item.confidenceMetadata.fieldConfidences.find(f => f.field === "unit_price")?.score ?? 0.5],
  ];

  for (const [field, value, conf] of fields) {
    ev = addEvidenceEntry(ev, buildRawExtractionEvidence(field, value, conf));
  }

  const hasFatalErrors = item.extractionErrors.some(e => e.fatal);
  if (hasFatalErrors) {
    flags.push("FATAL_EXTRACTION_ERROR");
    return { ok: false, flags, evidence: ev };
  }

  return { ok: true, flags, evidence: ev };
}

function stageLexical(rawDescription: string | null): {
  cleaned:  string | null;
  warnings: string[];
} {
  if (!rawDescription) return { cleaned: null, warnings: ["EMPTY_DESCRIPTION"] };

  let text = rawDescription.trim();

  // Remove sequências de espaços múltiplos
  text = text.replace(/\s{2,}/g, " ");

  // Remove caracteres de controle
  text = text.replace(/[\x00-\x1F\x7F]/g, "");

  // Trunca se muito longo (> 500 chars)
  const warnings: string[] = [];
  if (text.length > 500) {
    text = text.slice(0, 500).trim();
    warnings.push("DESCRIPTION_TRUNCATED");
  }

  // Normaliza capitalização: primeira letra maiúscula
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return { cleaned: text || null, warnings };
}

function stageUnit(rawUnit: string | null): {
  canonical:   string | null;
  matchSource: string | null;
  confidence:  number;
  warnings:    string[];
} {
  if (!rawUnit || rawUnit.trim().length === 0) {
    return { canonical: null, matchSource: null, confidence: 0, warnings: ["MISSING_UNIT"] };
  }

  const result = normalizeUnit(rawUnit.trim());
  if (!result.canonical) {
    return {
      canonical:   null,
      matchSource: null,
      confidence:  0.1,
      warnings:    [`UNKNOWN_UNIT:${rawUnit}`],
    };
  }

  return {
    canonical:   result.canonical,
    matchSource: result.source,
    confidence:  result.confidence,
    warnings:    [],
  };
}

function parseLocalePtBr(value: string | null): number | null {
  if (!value || value.trim().length === 0) return null;
  // PT-BR: ponto como separador de milhar, vírgula como decimal
  // Ex: "1.234,56" → 1234.56
  const cleaned = value
    .replace(/[R$\s]/g, "")   // remove R$ e espaços
    .replace(/\./g, "")       // remove pontos de milhar
    .replace(",", ".");       // converte vírgula decimal em ponto
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function stageQuantity(rawQuantity: string | null): {
  parsed:   number | null;
  warnings: string[];
} {
  const parsed = parseLocalePtBr(rawQuantity);
  const warnings: string[] = [];

  if (parsed === null) {
    warnings.push("UNPARSEABLE_QUANTITY");
  } else if (parsed <= 0) {
    warnings.push("NON_POSITIVE_QUANTITY");
  } else if (parsed > 1_000_000) {
    warnings.push("SUSPICIOUSLY_LARGE_QUANTITY");
  }

  return { parsed, warnings };
}

function stagePrice(
  rawUnitPrice:  string | null,
  rawTotalPrice: string | null,
  quantity:      number | null,
  strictCheck:   boolean,
): {
  unitPrice:  number | null;
  totalPrice: number | null;
  warnings:   string[];
} {
  const unitPrice  = parseLocalePtBr(rawUnitPrice);
  const totalPrice = parseLocalePtBr(rawTotalPrice);
  const warnings:  string[] = [];

  if (unitPrice === null && rawUnitPrice) warnings.push("UNPARSEABLE_UNIT_PRICE");
  if (totalPrice === null && rawTotalPrice) warnings.push("UNPARSEABLE_TOTAL_PRICE");

  if (unitPrice !== null && unitPrice < 0)  warnings.push("NEGATIVE_UNIT_PRICE");
  if (totalPrice !== null && totalPrice < 0) warnings.push("NEGATIVE_TOTAL_PRICE");

  // Verificação de consistência: unitPrice * qty ≈ totalPrice
  if (strictCheck && unitPrice !== null && quantity !== null && totalPrice !== null) {
    const expected  = unitPrice * quantity;
    const tolerance = expected * 0.01; // 1% de tolerância
    if (Math.abs(expected - totalPrice) > tolerance) {
      warnings.push(`PRICE_MISMATCH:expected=${expected.toFixed(2)},actual=${totalPrice.toFixed(2)}`);
    }
  }

  return { unitPrice, totalPrice, warnings };
}

function stageSemantic(
  description:    string | null,
  organizationId: number,
  maxCandidates:  number,
  minScore:       number,
  stagingItemId:  string,
  importSessionId: number,
): CandidateSet {
  if (!description) {
    return {
      stagingItemId,
      candidates:        [],
      bestCandidate:     null,
      hasHighConfidence: false,
      requiresReview:    true,
      generatedAt:       new Date().toISOString(),
    };
  }

  const results = globalSemanticIndex.search(description, organizationId, maxCandidates, minScore);

  const candidates: SemanticCandidate[] = results.map(({ entry, result }) =>
    createSemanticCandidate(stagingItemId, importSessionId, organizationId, {
      proposedDescription: entry.canonicalText,
      score:               result.score,
      source:              result.strategy === "exact"  ? "exact_match"  :
                           result.strategy === "alias"  ? "alias_match"  :
                           result.strategy === "fuzzy"  ? "fuzzy_match"  :
                           result.strategy === "prefix" ? "prefix_match" :
                                                          "token_match",
      explanation:         buildExplanation(
        `Correspondência via ${result.strategy}: "${description}" → "${entry.canonicalText}"`,
        result.matchedOn,
      ),
      originalRaw:         description,
      catmatCode:          entry.catmatCode,
      catmatDesc:          entry.canonicalText,
      catmatGroup:         entry.catmatGroup,
      indexEntryId:        entry.id,
    }),
  );

  return buildCandidateSet(stagingItemId, candidates);
}

function stageReviewPrep(
  description:    string | null,
  canonicalUnit:  string | null,
  quantity:       number | null,
  unitPrice:      number | null,
  candidateSet:   CandidateSet,
  allWarnings:    string[],
): { requiresReview: boolean; reviewFlags: string[] } {
  const flags: string[] = [...allWarnings];

  if (!description)   flags.push("NO_DESCRIPTION");
  if (!canonicalUnit) flags.push("NO_UNIT");
  if (quantity === null) flags.push("NO_QUANTITY");

  const hasHighConf = candidateSet.hasHighConfidence;
  const hasManyWarnings = allWarnings.length >= 3;
  const hasPriceIssue = allWarnings.some(w => w.includes("PRICE"));

  const requiresReview =
    !hasHighConf         ||
    hasManyWarnings      ||
    hasPriceIssue        ||
    !description         ||
    !canonicalUnit;

  return { requiresReview, reviewFlags: [...new Set(flags)] };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runNormalizationPipeline(
  item:    RawExtractedItem,
  options: PipelineOptions,
): Promise<NormalizedItem> {
  const startTotal = Date.now();
  const stageResults: StageResult[] = [];
  const allWarnings: string[] = [];

  const orgId = options.organizationId;
  const maxCandidates  = options.maxCandidates  ?? 5;
  const minScore       = options.minCandidateScore ?? 0.35;
  const strictPrice    = options.strictPriceCheck ?? false;

  let evidence = createExtractionEvidence(
    item.id,
    item.importSessionId,
    orgId,
    item.sourceLocation,
  );

  // Stage 1: Raw validation
  const s1start = Date.now();
  const s1 = stageRaw(item, evidence);
  evidence = s1.evidence;
  const s1result: StageResult = {
    stage: 1, name: "raw",
    status: s1.ok ? "ok" : "failed",
    durationMs: Date.now() - s1start,
    warnings: s1.flags.filter(f => !f.startsWith("FATAL")),
    errors:   s1.flags.filter(f => f.startsWith("FATAL")),
  };
  stageResults.push(s1result);
  allWarnings.push(...s1result.warnings);

  if (!s1.ok) {
    return buildFailedResult(item, orgId, stageResults, evidence, Date.now() - startTotal);
  }

  // Stage 2: Lexical
  const s2start = Date.now();
  const s2 = stageLexical(item.rawDescription);
  const s2result: StageResult = {
    stage: 2, name: "lexical",
    status: s2.warnings.length > 0 ? "warning" : "ok",
    durationMs: Date.now() - s2start,
    warnings: s2.warnings,
    errors: [],
  };
  stageResults.push(s2result);
  allWarnings.push(...s2.warnings);

  // Stage 3: Unit
  const s3start = Date.now();
  const s3 = stageUnit(item.rawUnit);
  if (s3.matchSource !== null) {
    evidence = addEvidenceEntry(evidence, buildUnitNormalizationEvidence(
      item.rawUnit, s3.canonical, s3.matchSource, s3.confidence,
    ));
  }
  const s3result: StageResult = {
    stage: 3, name: "unit",
    status: s3.warnings.length > 0 ? "warning" : "ok",
    durationMs: Date.now() - s3start,
    warnings: s3.warnings,
    errors: [],
  };
  stageResults.push(s3result);
  allWarnings.push(...s3.warnings);

  // Stage 4: Quantity
  const s4start = Date.now();
  const s4 = stageQuantity(item.rawQuantity);
  const s4result: StageResult = {
    stage: 4, name: "quantity",
    status: s4.warnings.length > 0 ? "warning" : "ok",
    durationMs: Date.now() - s4start,
    warnings: s4.warnings,
    errors: [],
  };
  stageResults.push(s4result);
  allWarnings.push(...s4.warnings);

  // Stage 5: Price
  const s5start = Date.now();
  const s5 = stagePrice(item.rawUnitPrice, item.rawTotalPrice, s4.parsed, strictPrice);
  const s5result: StageResult = {
    stage: 5, name: "price",
    status: s5.warnings.length > 0 ? "warning" : "ok",
    durationMs: Date.now() - s5start,
    warnings: s5.warnings,
    errors: [],
  };
  stageResults.push(s5result);
  allWarnings.push(...s5.warnings);

  // Stage 6: Semantic candidates
  const s6start = Date.now();
  let candidateSet: CandidateSet;
  if (options.skipSemanticStage) {
    candidateSet = {
      stagingItemId:     item.id,
      candidates:        [],
      bestCandidate:     null,
      hasHighConfidence: false,
      requiresReview:    true,
      generatedAt:       new Date().toISOString(),
    };
  } else {
    candidateSet = stageSemantic(s2.cleaned, orgId, maxCandidates, minScore, item.id, item.importSessionId);
  }
  const s6result: StageResult = {
    stage: 6, name: "semantic",
    status: options.skipSemanticStage ? "skipped" : "ok",
    durationMs: Date.now() - s6start,
    warnings: candidateSet.candidates.length === 0 ? ["NO_SEMANTIC_CANDIDATES"] : [],
    errors: [],
  };
  stageResults.push(s6result);
  allWarnings.push(...s6result.warnings);

  // Stage 7: Review preparation
  const s7start = Date.now();
  const s7 = stageReviewPrep(s2.cleaned, s3.canonical, s4.parsed, s5.unitPrice, candidateSet, allWarnings);
  const s7result: StageResult = {
    stage: 7, name: "review_prep",
    status: "ok",
    durationMs: Date.now() - s7start,
    warnings: [],
    errors: [],
  };
  stageResults.push(s7result);

  // Compute overall confidence
  const confScores = [
    s3.confidence,
    s4.parsed !== null ? 0.9 : 0.2,
    s5.unitPrice !== null ? 0.85 : 0.3,
    candidateSet.bestCandidate?.score ?? 0.3,
  ];
  const overallConfidence = confScores.reduce((a, b) => a + b, 0) / confScores.length;

  return {
    stagingItemId:     item.id,
    importSessionId:   item.importSessionId,
    organizationId:    orgId,
    description:       s2.cleaned,
    canonicalUnit:     s3.canonical,
    unitMatchSource:   s3.matchSource,
    quantity:          s4.parsed,
    unitPrice:         s5.unitPrice,
    totalPrice:        s5.totalPrice,
    overallConfidence,
    requiresReview:    s7.requiresReview,
    reviewFlags:       s7.reviewFlags,
    candidateSet,
    evidence,
    stageResults,
    totalDurationMs:   Date.now() - startTotal,
    pipelineVersion:   PIPELINE_VERSION,
  };
}

function buildFailedResult(
  item:          RawExtractedItem,
  orgId:         number,
  stageResults:  StageResult[],
  evidence:      ExtractionEvidence,
  durationMs:    number,
): NormalizedItem {
  return {
    stagingItemId:    item.id,
    importSessionId:  item.importSessionId,
    organizationId:   orgId,
    description:      null,
    canonicalUnit:    null,
    unitMatchSource:  null,
    quantity:         null,
    unitPrice:        null,
    totalPrice:       null,
    overallConfidence: 0,
    requiresReview:   true,
    reviewFlags:      ["PIPELINE_FAILED"],
    candidateSet: {
      stagingItemId:     item.id,
      candidates:        [],
      bestCandidate:     null,
      hasHighConfidence: false,
      requiresReview:    true,
      generatedAt:       new Date().toISOString(),
    },
    evidence,
    stageResults,
    totalDurationMs:  durationMs,
    pipelineVersion:  PIPELINE_VERSION,
  };
}

// ─── Batch pipeline ───────────────────────────────────────────────────────────

export interface BatchPipelineResult {
  results:      NormalizedItem[];
  totalItems:   number;
  successful:   number;
  failed:       number;
  totalMs:      number;
  avgConfidence: number;
}

export async function runBatchNormalization(
  items:   RawExtractedItem[],
  options: PipelineOptions,
): Promise<BatchPipelineResult> {
  const start   = Date.now();
  const results = await Promise.all(items.map(item => runNormalizationPipeline(item, options)));

  const successful = results.filter(r => !r.reviewFlags.includes("PIPELINE_FAILED")).length;
  const avgConf    = results.length > 0
    ? results.reduce((s, r) => s + r.overallConfidence, 0) / results.length
    : 0;

  return {
    results,
    totalItems:    items.length,
    successful,
    failed:        items.length - successful,
    totalMs:       Date.now() - start,
    avgConfidence: avgConf,
  };
}
