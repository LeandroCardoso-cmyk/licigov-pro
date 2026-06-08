/**
 * Sprint 3.0 — Clause Intelligence.
 *
 * Motor de recomendação de cláusulas para Termos de Referência, baseado nas
 * características do item (ItemTR) e no contexto do processo. Recomenda cláusulas,
 * resolve condicionais, injeta referências legais (Lei 14.133/2021) e mantém
 * explicabilidade e proveniência por cláusula.
 *
 * PRINCÍPIOS:
 *   - Seleção determinística: mesmas entradas → mesma ordem de recomendações.
 *   - Ordering estável: priority → relevanceScore → id (lexicográfico).
 *   - Override explícito: cláusulas podem sobrescrever recomendações automáticas.
 *   - Toda cláusula recomendada carrega rationale legível e base legal.
 *
 * Embasamento: princípios da legalidade, motivação e segurança jurídica
 * (Lei 14.133/2021, art. 5º).
 */

import { createHash } from "crypto";
import type { ClauseType } from "./trComposition";
import { evaluateCondition, type CompositionContext } from "./trComposition";

// ─── Procurement types ────────────────────────────────────────────────────────

export type ProcurementType =
  | "bem"          // aquisição de bens/materiais (CATMAT)
  | "servico"      // contratação de serviços (CATSER)
  | "obra"         // obras e serviços de engenharia
  | "tic"          // soluções de tecnologia da informação
  | "generico";    // categoria não identificada

// ─── Clause template ──────────────────────────────────────────────────────────

export interface ClauseTemplate {
  id:            string;
  type:          ClauseType;
  title:         string;
  content:       string;            // template com {{var}} placeholders
  legalBasis:    string | null;     // ex: "Art. 40, §1º, Lei 14.133/2021"
  priority:      number;            // maior = mais importante
  appliesTo:     ProcurementType[]; // tipos de contratação aplicáveis
  baseRelevance: number;            // 0–1, relevância base
}

// ─── Conditional clause ───────────────────────────────────────────────────────

export interface ConditionalClause {
  templateId: string;
  condition:  string;   // ex: "context.requiresWarranty"
}

// ─── Semantic clause ──────────────────────────────────────────────────────────

export interface SemanticClause {
  templateId:   string;
  matchTokens:  string[]; // tokens que disparam a cláusula
  bonus:        number;   // bônus de relevância quando o item contém os tokens
}

// ─── Clause risk link ─────────────────────────────────────────────────────────

export interface ClauseRiskLink {
  templateId: string;
  riskCode:   string;
  severity:   "low" | "medium" | "high";
  rationale:  string;
}

// ─── Procurement type → clause association ────────────────────────────────────

export interface ProcurementTypeClause {
  procurementType: ProcurementType;
  templateIds:     string[];
}

// ─── Clause recommendation (output) ───────────────────────────────────────────

export interface ClauseRecommendation {
  id:             string;          // determinístico: hash(templateId+itemId)
  templateId:     string;
  type:           ClauseType;
  title:          string;
  content:        string;          // já com substituições aplicadas
  legalBasis:     string | null;
  priority:       number;
  relevanceScore: number;          // 0–1
  rationale:      string;          // explicabilidade legível
  source:         "type_match" | "semantic_match" | "conditional" | "override";
  isOverride:     boolean;
}

// ─── Recommendation context ───────────────────────────────────────────────────

export interface ClauseRecommendationContext {
  procurementType:    ProcurementType;
  templates:          ClauseTemplate[];
  conditionals?:      ConditionalClause[];
  semanticClauses?:   SemanticClause[];
  overrides?:         ClauseTemplate[];     // cláusulas forçadas pelo usuário
  compositionContext?: CompositionContext;  // variáveis para condicionais/templates
}

// ─── Minimal item shape (avoids circular dep with itemTR) ─────────────────────

export interface ClauseItemInput {
  id:                    string;
  normalizedDescription: string;
  canonicalUnit:         string | null;
  catmatCode:            string | null;
  catserCode:            string | null;
}

// ─── Deterministic id ─────────────────────────────────────────────────────────

function recommendationId(templateId: string, itemId: string): string {
  return createHash("sha256")
    .update(`${templateId}::${itemId}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

// ─── Legal reference injection ────────────────────────────────────────────────

/**
 * Injeta a referência legal no conteúdo da cláusula, se houver base legal e
 * a referência ainda não estiver presente.
 */
export function injectLegalReference(content: string, legalBasis: string | null): string {
  if (!legalBasis) return content;
  if (content.includes(legalBasis)) return content;
  return `${content}\n\n(Fundamento legal: ${legalBasis}.)`;
}

// ─── Template selection ───────────────────────────────────────────────────────

/**
 * Seleciona o melhor template para um tipo de procurement entre os candidatos,
 * de forma determinística (priority → baseRelevance → id).
 */
export function selectClauseTemplate(
  templates:       ClauseTemplate[],
  procurementType: ProcurementType,
): ClauseTemplate | null {
  const applicable = templates.filter(
    t => t.appliesTo.includes(procurementType) || t.appliesTo.includes("generico"),
  );
  if (applicable.length === 0) return null;
  const sorted = [...applicable].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.baseRelevance !== a.baseRelevance) return b.baseRelevance - a.baseRelevance;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

// ─── Conditional evaluation ───────────────────────────────────────────────────

/**
 * Avalia se uma cláusula condicional deve ser incluída no contexto fornecido.
 * Reusa evaluateCondition de trComposition (avaliação segura, sem eval).
 */
export function evaluateConditionalClause(
  clause:  ConditionalClause,
  context: CompositionContext,
): boolean {
  return evaluateCondition(clause.condition, context);
}

// ─── Link clause to item ──────────────────────────────────────────────────────

export interface ClauseItemLink {
  recommendationId: string;
  templateId:       string;
  itemId:           string;
  linkedAt:         string; // ISO 8601 (não afeta determinismo de ordering)
}

export function linkClauseToItem(
  recommendation: ClauseRecommendation,
  item:           ClauseItemInput,
): ClauseItemLink {
  return {
    recommendationId: recommendation.id,
    templateId:       recommendation.templateId,
    itemId:           item.id,
    linkedAt:         new Date().toISOString(),
  };
}

// ─── Tokenization (lightweight, deterministic) ────────────────────────────────

function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

// ─── Core: recommend clauses ──────────────────────────────────────────────────

/**
 * Recomenda cláusulas para um item, de forma determinística.
 * Ordering estável: priority DESC → relevanceScore DESC → id ASC.
 * Overrides têm precedência e são marcados com isOverride=true.
 */
export function recommendClauses(
  item:    ClauseItemInput,
  context: ClauseRecommendationContext,
): ClauseRecommendation[] {
  const compositionContext = context.compositionContext ?? {};
  const itemTokens = new Set(tokensOf(item.normalizedDescription));
  const out: ClauseRecommendation[] = [];
  const seenTemplateIds = new Set<string>();

  // 1. Overrides (precedência máxima).
  for (const tmpl of context.overrides ?? []) {
    if (seenTemplateIds.has(tmpl.id)) continue;
    seenTemplateIds.add(tmpl.id);
    out.push(buildRecommendation(tmpl, item, compositionContext, "override", 1.0, true,
      `Cláusula incluída por override explícito do usuário.`));
  }

  // 2. Type-matched templates.
  for (const tmpl of context.templates) {
    if (seenTemplateIds.has(tmpl.id)) continue;
    const appliesType =
      tmpl.appliesTo.includes(context.procurementType) || tmpl.appliesTo.includes("generico");
    if (!appliesType) continue;

    // Semantic bonus.
    let relevance = tmpl.baseRelevance;
    let source: ClauseRecommendation["source"] = "type_match";
    let rationale =
      `Cláusula aplicável ao tipo de contratação "${context.procurementType}" ` +
      `(relevância base ${tmpl.baseRelevance.toFixed(2)}).`;

    const semantic = (context.semanticClauses ?? []).find(s => s.templateId === tmpl.id);
    if (semantic) {
      const matched = semantic.matchTokens.filter(t => itemTokens.has(t.toLowerCase()));
      if (matched.length > 0) {
        relevance = clamp01(relevance + semantic.bonus * (matched.length / semantic.matchTokens.length));
        source = "semantic_match";
        rationale =
          `Cláusula reforçada por correspondência semântica (tokens: ${matched.join(", ")}); ` +
          `relevância ajustada para ${relevance.toFixed(2)}.`;
      }
    }

    seenTemplateIds.add(tmpl.id);
    out.push(buildRecommendation(tmpl, item, compositionContext, source, relevance, false, rationale));
  }

  // 3. Conditional clauses.
  for (const cond of context.conditionals ?? []) {
    if (seenTemplateIds.has(cond.templateId)) continue;
    if (!evaluateConditionalClause(cond, compositionContext)) continue;
    const tmpl = context.templates.find(t => t.id === cond.templateId)
      ?? (context.overrides ?? []).find(t => t.id === cond.templateId);
    if (!tmpl) continue;
    seenTemplateIds.add(tmpl.id);
    out.push(buildRecommendation(tmpl, item, compositionContext, "conditional", tmpl.baseRelevance, false,
      `Cláusula incluída por condição satisfeita: "${cond.condition}".`));
  }

  // Deterministic stable sort: priority DESC → relevance DESC → id ASC.
  return out.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (Math.abs(b.relevanceScore - a.relevanceScore) > 1e-9) {
      return b.relevanceScore - a.relevanceScore;
    }
    return a.id.localeCompare(b.id);
  });
}

function buildRecommendation(
  tmpl:               ClauseTemplate,
  item:               ClauseItemInput,
  compositionContext: CompositionContext,
  source:             ClauseRecommendation["source"],
  relevanceScore:     number,
  isOverride:         boolean,
  rationale:          string,
): ClauseRecommendation {
  const substituted = substitute(tmpl.content, compositionContext);
  const content = injectLegalReference(substituted, tmpl.legalBasis);
  return {
    id:             recommendationId(tmpl.id, item.id),
    templateId:     tmpl.id,
    type:           tmpl.type,
    title:          tmpl.title,
    content,
    legalBasis:     tmpl.legalBasis,
    priority:       tmpl.priority,
    relevanceScore: clamp01(relevanceScore),
    rationale,
    source,
    isOverride,
  };
}

// ─── Template substitution (local, mirrors trComposition) ─────────────────────

function substitute(content: string, context: CompositionContext): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (_m, varName: string) => {
    const key = varName.trim();
    const parts = key.split(".");
    let value: unknown = context;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return `{{${key}}}`;
      value = (value as Record<string, unknown>)[part];
    }
    if (value == null) return `{{${key}}}`;
    return String(value);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// ─── Procurement type inference ───────────────────────────────────────────────

/**
 * Infere o tipo de contratação a partir dos vínculos de catálogo do item.
 * Determinístico.
 */
export function inferProcurementType(item: ClauseItemInput): ProcurementType {
  if (item.catserCode) return "servico";
  if (item.catmatCode) return "bem";
  return "generico";
}

// ─── Sprint 4.3: Clause Compatibility & Conflict Analysis ─────────────────────

export interface ClauseCompatibilityResult {
  clauseIdA: string;
  clauseIdB: string;
  organizationId: number;
  isCompatible: boolean;
  compatibilityScore: number;   // 0-1
  conflictType: "direct" | "indirect" | "conditional" | "none";
  explanation: string;
  resolution: string | null;
  checkedAt: string;
}

export interface ClauseHierarchyNode {
  clauseId: string;
  organizationId: number;
  parentId: string | null;
  childIds: string[];
  depth: number;
  legalBasis: string;
  isRoot: boolean;
  isLeaf: boolean;
}

export interface ClauseRiskAnalysis {
  clauseId: string;
  organizationId: number;
  riskLevel: "critical" | "high" | "medium" | "low" | "none";
  riskFactors: string[];
  legalExposure: string;
  mitigationSuggestion: string;
  riskScore: number;    // 0-1
  analyzedAt: string;
}

export interface ClauseConflictMap {
  organizationId: number;
  clauseIds: string[];
  conflicts: ClauseCompatibilityResult[];
  conflictCount: number;
  criticalConflicts: number;
  resolutionSuggestions: Record<string, string>;  // conflictKey → suggestion
  generatedAt: string;
}

export function checkClauseCompatibility(
  clauseIdA: string,
  clauseIdB: string,
  contentA: string,
  contentB: string,
  organizationId: number,
): ClauseCompatibilityResult {
  // Simple heuristic: if both contents share >30% token overlap → potentially conflicting
  const tokensA = new Set(contentA.toLowerCase().split(/\s+/));
  const tokensB = new Set(contentB.toLowerCase().split(/\s+/));
  const tokensAArr = Array.from(tokensA);
  const intersection = tokensAArr.filter(t => tokensB.has(t)).length;
  const union = new Set(tokensAArr.concat(Array.from(tokensB))).size;
  const overlap = union > 0 ? intersection / union : 0;
  const isCompatible = overlap < 0.3;
  return {
    clauseIdA,
    clauseIdB,
    organizationId,
    isCompatible,
    compatibilityScore: 1 - overlap,
    conflictType: isCompatible ? "none" : overlap > 0.6 ? "direct" : "indirect",
    explanation: isCompatible
      ? "Cláusulas compatíveis (baixa sobreposição semântica)"
      : `Conflito detectado: sobreposição de ${(overlap * 100).toFixed(1)}%`,
    resolution: isCompatible ? null : "Revisar e consolidar cláusulas sobrepostas",
    checkedAt: new Date().toISOString(),
  };
}

export function buildClauseHierarchy(
  clauses: Array<{ id: string; organizationId: number; parentId?: string | null; legalBasis?: string }>,
): ClauseHierarchyNode[] {
  const childMap = new Map<string, string[]>();
  for (const c of clauses) {
    if (c.parentId) {
      const arr = childMap.get(c.parentId) ?? [];
      arr.push(c.id);
      childMap.set(c.parentId, arr);
    }
  }
  const depthMap = new Map<string, number>();
  function getDepth(id: string): number {
    if (depthMap.has(id)) return depthMap.get(id)!;
    const clause = clauses.find(c => c.id === id);
    const d = clause?.parentId ? 1 + getDepth(clause.parentId) : 0;
    depthMap.set(id, d);
    return d;
  }
  return clauses.map(c => ({
    clauseId: c.id,
    organizationId: c.organizationId,
    parentId: c.parentId ?? null,
    childIds: childMap.get(c.id) ?? [],
    depth: getDepth(c.id),
    legalBasis: c.legalBasis ?? "",
    isRoot: !c.parentId,
    isLeaf: (childMap.get(c.id) ?? []).length === 0,
  }));
}

export function analyzeClauseRisk(
  clauseId: string,
  content: string,
  legalBasis: string,
  organizationId: number,
): ClauseRiskAnalysis {
  const riskFactors: string[] = [];
  let riskScore = 0;
  if (content.length < 50) { riskFactors.push("Cláusula muito curta"); riskScore += 0.2; }
  if (!legalBasis || legalBasis.length < 5) { riskFactors.push("Sem embasamento legal"); riskScore += 0.3; }
  if (/obrigatório|deverá|deve/i.test(content) && !/exceto|salvo/i.test(content)) {
    riskFactors.push("Obrigação sem exceção explícita");
    riskScore += 0.15;
  }
  if (/multa|penalidade|rescisão/i.test(content)) { riskFactors.push("Cláusula penal"); riskScore += 0.1; }
  riskScore = Math.min(1, riskScore);
  const level: ClauseRiskAnalysis["riskLevel"] =
    riskScore >= 0.7 ? "critical" : riskScore >= 0.5 ? "high" : riskScore >= 0.3 ? "medium" : riskScore >= 0.1 ? "low" : "none";
  return {
    clauseId,
    organizationId,
    riskLevel: level,
    riskFactors,
    legalExposure: riskFactors.length > 0 ? riskFactors.join("; ") : "Sem exposição identificada",
    mitigationSuggestion: riskFactors.length > 0 ? "Revisar cláusula e adicionar embasamento legal específico" : "Nenhuma mitigação necessária",
    riskScore,
    analyzedAt: new Date().toISOString(),
  };
}

export function buildClauseConflictMap(
  clauses: Array<{ id: string; content: string; organizationId: number }>,
): ClauseConflictMap {
  const conflicts: ClauseCompatibilityResult[] = [];
  const organizationId = clauses[0]?.organizationId ?? 0;
  for (let i = 0; i < clauses.length; i++) {
    for (let j = i + 1; j < clauses.length; j++) {
      const result = checkClauseCompatibility(
        clauses[i].id, clauses[j].id,
        clauses[i].content, clauses[j].content,
        organizationId,
      );
      if (!result.isCompatible) conflicts.push(result);
    }
  }
  const criticalConflicts = conflicts.filter(c => c.conflictType === "direct").length;
  const resolutionSuggestions: Record<string, string> = {};
  for (const c of conflicts) {
    const key = `${c.clauseIdA}:${c.clauseIdB}`;
    resolutionSuggestions[key] = c.resolution ?? "Revisar manualmente";
  }
  return {
    organizationId,
    clauseIds: clauses.map(c => c.id),
    conflicts,
    conflictCount: conflicts.length,
    criticalConflicts,
    resolutionSuggestions,
    generatedAt: new Date().toISOString(),
  };
}
