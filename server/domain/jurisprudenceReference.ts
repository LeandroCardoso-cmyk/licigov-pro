/**
 * Sprint 4.3 — Jurisprudence Reference Domain.
 *
 * Motor de correlação e hierarquização de precedentes jurídicos (TCU, AGU, CGU,
 * STJ, STF, CARF, CNJ) para embasar documentos de licitação conforme
 * Lei 14.133/2021.
 *
 * PRINCÍPIOS:
 *   - Determinismo: ranking e scores determinísticos (mesmas entradas → mesma saída).
 *   - Authority weight: TCU/STF têm maior peso por relevância em licitações públicas.
 *   - Keyword overlap: correlação baseada em interseção de tokens normalizados.
 *   - Multi-tenant: organizationId obrigatório.
 *   - Proveniência: toda citação referencia a fonte original.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type JurisprudenceType = "acórdão" | "súmula" | "decisão" | "orientação" | "parecer_normativo";
export type LegalAuthority = "TCU" | "AGU" | "CGU" | "STJ" | "STF" | "CARF" | "CNJ" | "outros";
export type ApplicabilityLevel = "directly_applicable" | "analogous" | "contextual" | "not_applicable";

export interface JurisprudenceReferenceLegacy {
  id: string;
  organizationId: number;
  jurisprudenceType: JurisprudenceType;
  authority: LegalAuthority;
  citation: string;           // ex: "TCU Acórdão 1234/2023 - Plenário"
  summary: string;
  relevantExcerpt: string;
  legalBasis: string[];
  keywords: string[];
  authorityWeight: number;    // 0-1 (TCU/STJ = high, outros = lower)
  year: number;
  url: string | null;
  isVerified: boolean;
  replayKey: string;
  createdAt: string;
}

export interface PrecedentHierarchy {
  primaryPrecedent: JurisprudenceReferenceLegacy;
  supportingPrecedents: JurisprudenceReferenceLegacy[];
  conflictingPrecedents: JurisprudenceReferenceLegacy[];
  hierarchyScore: number;     // 0-1
}

export interface LegalCitationLegacy {
  referenceId: string;
  citation: string;
  excerpt: string;
  applicabilityLevel: ApplicabilityLevel;
  applicabilityScore: number;
  contextualMatch: string[];  // keywords que geraram match
}

export interface ContextualApplicability {
  organizationId: number;
  query: string;
  references: JurisprudenceReferenceLegacy[];
  citations: LegalCitationLegacy[];
  topCitation: LegalCitationLegacy | null;
  overallApplicabilityScore: number;
  replayKey: string;
}

// ─── Authority weight map ─────────────────────────────────────────────────────

const AUTHORITY_WEIGHTS: Record<LegalAuthority, number> = {
  TCU:    0.95,
  STF:    0.95,
  STJ:    0.90,
  AGU:    0.80,
  CGU:    0.75,
  CNJ:    0.75,
  CARF:   0.70,
  outros: 0.50,
};

// ─── Opposite keywords for conflict detection ─────────────────────────────────

const CONFLICT_OPPOSITE_PAIRS: Array<[string, string]> = [
  ["proibido", "permitido"],
  ["vedado", "autorizado"],
  ["invalido", "valido"],
  ["ilegal", "legal"],
  ["nulo", "valido"],
];

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function deterministicId(input: string): string {
  return sha256Hex(input).slice(0, 20);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function intersect(setA: Set<string>, setB: Set<string>): string[] {
  return Array.from(setA).filter(item => setB.has(item));
}

function hasConflictingKeywords(keywordsA: string[], keywordsB: string[]): boolean {
  const setA = new Set(keywordsA.map(k => k.toLowerCase()));
  const setB = new Set(keywordsB.map(k => k.toLowerCase()));
  for (const [wordA, wordB] of CONFLICT_OPPOSITE_PAIRS) {
    if ((setA.has(wordA) && setB.has(wordB)) || (setA.has(wordB) && setB.has(wordA))) {
      return true;
    }
  }
  return false;
}

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Cria uma referência jurisprudencial com authorityWeight mapeado por autoridade.
 * replayKey = sha256(citation + authority + year.toString() + organizationId)
 */
export function createJurisprudenceReferenceLegacy(params: {
  organizationId: number;
  jurisprudenceType: JurisprudenceType;
  authority: LegalAuthority;
  citation: string;
  summary: string;
  relevantExcerpt: string;
  legalBasis?: string[];
  keywords?: string[];
  year: number;
  isVerified?: boolean;
  url?: string | null;
}): JurisprudenceReferenceLegacy {
  const authorityWeight = AUTHORITY_WEIGHTS[params.authority];
  const replayKey = sha256Hex(
    `${params.citation}${params.authority}${params.year.toString()}${params.organizationId}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    organizationId:    params.organizationId,
    jurisprudenceType: params.jurisprudenceType,
    authority:         params.authority,
    citation:          params.citation,
    summary:           params.summary,
    relevantExcerpt:   params.relevantExcerpt,
    legalBasis:        params.legalBasis ?? [],
    keywords:          params.keywords ?? [],
    authorityWeight,
    year:              params.year,
    url:               params.url ?? null,
    isVerified:        params.isVerified ?? false,
    replayKey,
    createdAt:         new Date().toISOString(),
  };
}

/**
 * Computa o score de aplicabilidade de uma referência para um contexto.
 * score = authorityWeight * 0.6 + keywordOverlap * 0.4
 */
export function computeApplicabilityScore(
  ref: JurisprudenceReferenceLegacy,
  context: string,
): number {
  const contextTokens = new Set(tokenize(context));
  const refKeywords   = ref.keywords.map(k => k.toLowerCase());
  const overlapCount  = refKeywords.filter(k => contextTokens.has(k)).length;
  const keywordOverlap = overlapCount / Math.max(refKeywords.length, 1);

  return Math.min(1, ref.authorityWeight * 0.6 + keywordOverlap * 0.4);
}

/**
 * Ordena referências por relevância para o contexto de forma determinística.
 * score = authorityWeight * 0.5 + keywordOverlap * 0.3 + (isVerified ? 0.2 : 0)
 * Desempate: citation asc (lexicográfico).
 */
export function rankPrecedents(
  refs: JurisprudenceReferenceLegacy[],
  context: string,
): JurisprudenceReferenceLegacy[] {
  const contextTokens = new Set(tokenize(context));

  const scored = refs.map(ref => {
    const refKeywords  = ref.keywords.map(k => k.toLowerCase());
    const overlapCount = refKeywords.filter(k => contextTokens.has(k)).length;
    const keywordOverlap = overlapCount / Math.max(refKeywords.length, 1);
    const score =
      ref.authorityWeight * 0.5
      + keywordOverlap * 0.3
      + (ref.isVerified ? 0.2 : 0);
    return { ref, score };
  });

  return scored
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
      return a.ref.citation.localeCompare(b.ref.citation);
    })
    .map(s => s.ref);
}

/**
 * Constrói a cadeia de citações ordenada por applicabilityScore desc.
 * applicabilityLevel: >= 0.7 → "directly_applicable", >= 0.4 → "analogous",
 *                     >= 0.2 → "contextual", else → "not_applicable"
 */
export function buildCitationChain(
  refs: JurisprudenceReferenceLegacy[],
  context: string,
): LegalCitationLegacy[] {
  const contextTokens = new Set(tokenize(context));

  const citations: LegalCitationLegacy[] = refs.map(ref => {
    const score           = computeApplicabilityScore(ref, context);
    const refKeywordSet   = new Set(ref.keywords.map(k => k.toLowerCase()));
    const contextualMatch = intersect(refKeywordSet, contextTokens);

    const applicabilityLevel: ApplicabilityLevel =
      score >= 0.7 ? "directly_applicable"
      : score >= 0.4 ? "analogous"
      : score >= 0.2 ? "contextual"
      : "not_applicable";

    return {
      referenceId:        ref.id,
      citation:           ref.citation,
      excerpt:            ref.relevantExcerpt,
      applicabilityLevel,
      applicabilityScore: score,
      contextualMatch,
    };
  });

  // Ordenar por score desc, depois citation asc (determinístico)
  return citations.sort((a, b) => {
    if (Math.abs(b.applicabilityScore - a.applicabilityScore) > 1e-9) {
      return b.applicabilityScore - a.applicabilityScore;
    }
    return a.citation.localeCompare(b.citation);
  });
}

/**
 * Correlaciona referências com um query e retorna ContextualApplicability.
 * replayKey = sha256(query + sorted(refs.map(r=>r.id)).join + organizationId)
 */
export function correlateWithContext(
  refs: JurisprudenceReferenceLegacy[],
  query: string,
  organizationId: number,
): ContextualApplicability {
  const ranked  = rankPrecedents(refs, query);
  const citations = buildCitationChain(ranked, query);
  const topCitation = citations.length > 0 ? citations[0] : null;

  const overallApplicabilityScore =
    citations.length === 0
      ? 0
      : citations.reduce((acc, c) => acc + c.applicabilityScore, 0) / citations.length;

  const sortedIds = [...refs.map(r => r.id)].sort().join("|");
  const replayKey = sha256Hex(`${query}${sortedIds}${organizationId}`);

  return {
    organizationId,
    query,
    references:                ranked,
    citations,
    topCitation,
    overallApplicabilityScore: Math.min(1, overallApplicabilityScore),
    replayKey,
  };
}

/**
 * Constrói a hierarquia de precedentes em torno de um precedente primário.
 * - supporting: refs com score >= 0.5 (excluindo primary)
 * - conflicting: refs onde keywords contêm opostos semânticos
 * - hierarchyScore = primary.authorityWeight
 */
export function buildPrecedentHierarchy(
  primary: JurisprudenceReferenceLegacy,
  all: JurisprudenceReferenceLegacy[],
  context: string,
): PrecedentHierarchy {
  const others = all.filter(r => r.id !== primary.id);

  const supporting: JurisprudenceReferenceLegacy[]  = [];
  const conflicting: JurisprudenceReferenceLegacy[] = [];

  for (const ref of others) {
    const score = computeApplicabilityScore(ref, context);

    if (hasConflictingKeywords(primary.keywords, ref.keywords)) {
      conflicting.push(ref);
    } else if (score >= 0.5) {
      supporting.push(ref);
    }
  }

  return {
    primaryPrecedent:    primary,
    supportingPrecedents: supporting,
    conflictingPrecedents: conflicting,
    hierarchyScore:      primary.authorityWeight,
  };
}

// ─── Sprint 4.3: Extended Jurisprudence Types & Functions ─────────────────────

export type CourtLevel = "supreme" | "superior" | "regional" | "federal" | "state" | "administrative";
export type PrecedentStrength = "binding" | "persuasive" | "informative" | "overruled";
export type CitationType = "direct" | "analogical" | "distinguishing" | "overruling";

export interface JurisprudenceReferenceV2 {
  id: string;
  organizationId: number;
  caseNumber: string;
  court: string;
  courtLevel: CourtLevel;
  judgmentDate: string;   // ISO date
  summary: string;
  holdings: string[];     // key legal holdings
  legalBasis: string[];   // statutes cited
  keywords: string[];
  precedentStrength: PrecedentStrength;
  isActive: boolean;
  createdAt: string;
}

export interface PrecedentHierarchyNode {
  id: string;
  organizationId: number;
  parentId: string | null;   // superior precedent
  childIds: string[];        // subordinate precedents
  referenceId: string;       // points to JurisprudenceReferenceV2
  hierarchyLevel: number;    // 1 = supreme
  isOverruled: boolean;
  overruledBy: string | null;
  createdAt: string;
}

export interface LegalCitationV2 {
  id: string;
  organizationId: number;
  sourceId: string;      // document/clause/draft citing
  referenceId: string;   // JurisprudenceReferenceV2 being cited
  citationType: CitationType;
  relevanceScore: number;  // 0-1
  context: string;         // excerpt where cited
  createdAt: string;
}

const PRECEDENT_STRENGTH_ORDER: Record<PrecedentStrength, number> = {
  binding: 4,
  persuasive: 3,
  informative: 2,
  overruled: 1,
};

const PRECEDENT_STRENGTH_WEIGHT: Record<PrecedentStrength, number> = {
  binding: 1.0,
  persuasive: 0.8,
  informative: 0.6,
  overruled: 0.1,
};

export function createJurisprudenceReferenceV2(params: {
  organizationId: number;
  caseNumber: string;
  court: string;
  courtLevel?: CourtLevel;
  judgmentDate?: string;
  summary: string;
  holdings?: string[];
  legalBasis?: string[];
  keywords?: string[];
  precedentStrength?: PrecedentStrength;
}): JurisprudenceReferenceV2 {
  const now = new Date().toISOString();
  const id = sha256Hex(`jurv2:${params.organizationId}:${params.caseNumber}:${params.court}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    caseNumber: params.caseNumber,
    court: params.court,
    courtLevel: params.courtLevel ?? "administrative",
    judgmentDate: params.judgmentDate ?? now.slice(0, 10),
    summary: params.summary,
    holdings: params.holdings ?? [],
    legalBasis: params.legalBasis ?? [],
    keywords: params.keywords ?? [],
    precedentStrength: params.precedentStrength ?? "informative",
    isActive: true,
    createdAt: now,
  };
}

export function createPrecedentHierarchyNode(params: {
  organizationId?: number;
  referenceId?: string;
  reference?: JurisprudenceReferenceV2;  // test-compat: accept full ref object
  parentId?: string | null;
  hierarchyLevel?: number;
}): PrecedentHierarchyNode {
  const now = new Date().toISOString();
  const orgId = params.organizationId ?? params.reference?.organizationId ?? 0;
  const refId = params.referenceId ?? params.reference?.id ?? "";
  const id = sha256Hex(`precnode:${orgId}:${refId}:${params.parentId ?? "root"}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: orgId,
    parentId: params.parentId ?? null,
    childIds: [],
    referenceId: refId,
    hierarchyLevel: params.hierarchyLevel ?? 1,
    isOverruled: false,
    overruledBy: null,
    createdAt: now,
  };
}

export function createLegalCitationV2(params: {
  organizationId: number;
  sourceId: string;
  referenceId?: string;
  reference?: JurisprudenceReferenceV2;   // test-compat: accept full ref object
  citationType?: CitationType;
  relevanceScore?: number;
  context?: string;
  sessionId?: string;                      // test-compat — ignored
}): LegalCitationV2 {
  const now = new Date().toISOString();
  const refId = params.referenceId ?? params.reference?.id ?? "";
  const id = sha256Hex(`citv2:${params.organizationId}:${params.sourceId}:${refId}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    sourceId: params.sourceId,
    referenceId: refId,
    citationType: params.citationType ?? "direct",
    relevanceScore: params.relevanceScore ?? 1.0,
    context: params.context ?? "",
    createdAt: now,
  };
}

export function findRelevantPrecedentsV2(
  references: JurisprudenceReferenceV2[],
  keywordsOrQuery: string[] | string,
  legalBasis?: string[],
): JurisprudenceReferenceV2[] {
  // Accept both (refs, keywords[], legalBasis[]) and (refs, queryString) styles
  const keywords: string[] = Array.isArray(keywordsOrQuery)
    ? keywordsOrQuery
    : (keywordsOrQuery ?? "").toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const lb: string[] = legalBasis ?? [];
  const kwSet = new Set(keywords.map(k => k.toLowerCase()));
  const lbSet = new Set(lb.map(l => l.toLowerCase()));

  const filtered = references.filter(ref => {
    const refKwSet = new Set(ref.keywords.map(k => k.toLowerCase()));
    const hasKwOverlap = Array.from(kwSet).some(k => refKwSet.has(k));
    const refLbSet = new Set(ref.legalBasis.map(l => l.toLowerCase()));
    const hasLbOverlap = Array.from(lbSet).some(l => refLbSet.has(l));
    return hasKwOverlap || hasLbOverlap;
  });

  return filtered.sort((a, b) => {
    const strengthDiff = PRECEDENT_STRENGTH_ORDER[b.precedentStrength] - PRECEDENT_STRENGTH_ORDER[a.precedentStrength];
    if (strengthDiff !== 0) return strengthDiff;
    return b.judgmentDate.localeCompare(a.judgmentDate);
  });
}

export function rankPrecedentsByRelevanceV2(
  references: JurisprudenceReferenceV2[],
  query?: string,
): Array<JurisprudenceReferenceV2 & { relevanceScore: number }> {
  const queryTokens = new Set(
    (query ?? "").toLowerCase().split(/\s+/).filter(t => t.length >= 2),
  );

  return references
    .map(ref => {
      const refKwSet = ref.keywords.map(k => k.toLowerCase());
      const overlapCount = refKwSet.filter(k => queryTokens.has(k)).length;
      const overlapRatio = refKwSet.length === 0 ? 0 : overlapCount / refKwSet.length;
      const relevanceScore = overlapRatio * PRECEDENT_STRENGTH_WEIGHT[ref.precedentStrength];
      return { ...ref, relevanceScore };
    })
    .sort((a, b) => {
      if (Math.abs(b.relevanceScore - a.relevanceScore) > 1e-9) return b.relevanceScore - a.relevanceScore;
      return b.judgmentDate.localeCompare(a.judgmentDate);
    });
}

export function buildCitationGraphV2(citations: LegalCitationV2[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const citation of citations) {
    if (!graph[citation.sourceId]) graph[citation.sourceId] = [];
    if (!graph[citation.sourceId].includes(citation.referenceId)) {
      graph[citation.sourceId].push(citation.referenceId);
    }
  }
  return graph;
}

export function formatCitationV2(reference: JurisprudenceReferenceV2): string {
  const excerpt = reference.summary.length > 100
    ? `${reference.summary.slice(0, 100)}...`
    : reference.summary;
  return `${reference.court}, ${reference.caseNumber}, julgado em ${reference.judgmentDate}: ${excerpt}`;
}

// ─── Sprint 4.3: Canonical-name aliases for jurisprudence service layer ───────

/** Sprint 4.3 canonical JurisprudenceReference type alias */
export type JurisprudenceReference = JurisprudenceReferenceV2;

/** Sprint 4.3 canonical LegalCitation type alias */
export type LegalCitation = LegalCitationV2;

/** Sprint 4.3 canonical JurisprudenceReference type (explicit spec name) */
export type JurisprudenceReferenceSpec = JurisprudenceReferenceV2;

/** Sprint 4.3 canonical LegalCitation type (explicit spec name) */
export type LegalCitationSpec = LegalCitationV2;

/** @alias createJurisprudenceReferenceV2 — Sprint 4.3 canonical factory */
export const createJurisprudenceReference = createJurisprudenceReferenceV2;

/** @alias createJurisprudenceReferenceV2 (alt alias) */
export const createJurisprudenceReferenceSpec = createJurisprudenceReferenceV2;

/** @alias createLegalCitationV2 */
export const createLegalCitation = createLegalCitationV2;

/** @alias findRelevantPrecedentsV2 */
export const findRelevantPrecedents = findRelevantPrecedentsV2;

/** @alias rankPrecedentsByRelevanceV2 */
export const rankPrecedentsByRelevance = rankPrecedentsByRelevanceV2;

/** @alias buildCitationGraphV2 */
export const buildCitationGraph = buildCitationGraphV2;

/** @alias formatCitationV2 */
export const formatCitation = formatCitationV2;
