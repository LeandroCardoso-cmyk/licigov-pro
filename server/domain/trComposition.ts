/**
 * Sprint 2.95 — TR Composition Domain.
 *
 * Modelo de composição estrutural de Termos de Referência (TR).
 * Suporta cláusulas com templates, blocos condicionais e regras de composição.
 * Embasamento jurídico: Lei 14.133/2021 (Nova Lei de Licitações).
 *
 * PRINCÍPIO: a composição do TR é determinística dado um contexto fixo.
 * Regras são aplicadas em ordem de prioridade para garantir previsibilidade.
 */

import { nanoid } from "nanoid";
import type { ExtractionProvenance } from "./importProvenance";

// ─── Clause types ─────────────────────────────────────────────────────────────

export type ClauseType =
  | "header"        // cabeçalho do documento
  | "body"          // corpo principal
  | "item_list"     // lista de itens / objetos
  | "legal_basis"   // base legal (ex: Art. 6º, Lei 14.133/2021)
  | "justification" // justificativa técnica
  | "specification" // especificação técnica do objeto
  | "price_ref"     // referência de preços / pesquisa de mercado
  | "footer";       // rodapé / assinaturas

// ─── TR Clause ────────────────────────────────────────────────────────────────

export interface TRClause {
  id:               string;
  type:             ClauseType;
  content:          string;            // template com {{var}} placeholders
  legalBasis?:      string;            // ex: "Art. 6º, IX, Lei 14.133/2021"
  clauseProvenance?: ExtractionProvenance; // de onde veio esta cláusula
  isRequired:       boolean;
  fallback?:        TRClause | null;   // cláusula substituta se esta falhar
  dependsOn:        string[];          // ids de cláusulas das quais depende
}

// ─── TR Conditional Block ─────────────────────────────────────────────────────

export interface TRConditionalBlock {
  id:          string;
  condition:   string;         // ex: "context.hasItems", "context.requiresApproval"
  trueBranch:  TRClause[];
  falseBranch: TRClause[];
}

// ─── TR Section ───────────────────────────────────────────────────────────────

export interface TRSection {
  id:                string;
  title:             string;
  clauses:           TRClause[];
  order:             number;
  isOptional:        boolean;
  conditionalBlocks: TRConditionalBlock[];
}

// ─── Composition Rule ─────────────────────────────────────────────────────────

export type TRCompositionAction =
  | "include_section"  // forçar inclusão de uma seção
  | "exclude_section"  // excluir seção do output
  | "replace_clause"   // substituir uma cláusula por outra
  | "append_clause";   // adicionar cláusula extra a uma seção

export interface TRCompositionRule {
  id:        string;
  name:      string;
  condition: string;          // expressão de condição (ex: "context.modality === 'pregao'")
  action:    TRCompositionAction;
  targetId:  string;          // id de section ou clause alvo
  priority:  number;          // maior número = maior prioridade
}

// ─── Composition Context ─────────────────────────────────────────────────────

export type CompositionContext = Record<string, unknown>;

// ─── Condition Evaluator ──────────────────────────────────────────────────────

/**
 * Avalia condição simples baseada em key.subkey truthiness.
 * Suporta: "context.hasItems", "context.modality", valores escalares.
 * NÃO avalia expressões JavaScript arbitrárias por segurança.
 */
export function evaluateCondition(
  condition: string,
  context:   CompositionContext,
): boolean {
  if (!condition || condition.trim().length === 0) return false;

  // Remove "context." prefix se presente (convenção)
  const key = condition.startsWith("context.")
    ? condition.slice("context.".length)
    : condition;

  // Suporta chaves aninhadas: "key.subkey"
  const parts = key.split(".");
  let value: unknown = context;
  for (const part of parts) {
    if (value == null || typeof value !== "object") return false;
    value = (value as Record<string, unknown>)[part];
  }

  // Truthiness padrão JavaScript
  return Boolean(value);
}

// ─── Template Substitution ────────────────────────────────────────────────────

/**
 * Substitui {{var}} e {{key.subkey}} por valores do contexto.
 * Variáveis não encontradas são mantidas como {{var}} (não falham silenciosamente).
 */
export function substituteTemplate(
  content: string,
  context: CompositionContext,
): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (_match, varName: string) => {
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

// ─── Clause Resolution ────────────────────────────────────────────────────────

/**
 * Resolve as cláusulas de uma seção, incluindo blocos condicionais e fallbacks.
 * Se uma cláusula requerida não pode ser resolvida, usa o fallback se disponível.
 */
export function resolveClauses(
  section: TRSection,
  context: CompositionContext,
): TRClause[] {
  const resolved: TRClause[] = [...section.clauses];

  // Resolve blocos condicionais
  for (const block of section.conditionalBlocks) {
    const shouldUseTrueBranch = evaluateCondition(block.condition, context);
    const branchClauses = shouldUseTrueBranch ? block.trueBranch : block.falseBranch;
    resolved.push(...branchClauses);
  }

  // Aplica fallbacks para cláusulas requeridas com conteúdo vazio
  return resolved.map(clause => {
    if (clause.isRequired && clause.content.trim().length === 0 && clause.fallback) {
      return clause.fallback;
    }
    return clause;
  }).filter((clause): clause is TRClause => clause != null);
}

// ─── TR Outline Builder ───────────────────────────────────────────────────────

/**
 * Constrói o outline do TR aplicando regras de composição em ordem de prioridade.
 * Regras são aplicadas do maior para menor prioridade.
 * Retorna seções ordenadas pelo campo `order`.
 */
export function buildTROutline(
  sections: TRSection[],
  rules:    TRCompositionRule[],
  context:  CompositionContext,
): TRSection[] {
  // Cria cópia mutável para aplicar regras
  let result: TRSection[] = [...sections];

  // Ordena regras por prioridade DESC
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    // Avalia condição da regra
    if (!evaluateCondition(rule.condition, context)) continue;

    switch (rule.action) {
      case "include_section": {
        // Garante que a seção está no resultado (não duplica se já existir)
        const alreadyIncluded = result.some(s => s.id === rule.targetId);
        if (!alreadyIncluded) {
          const target = sections.find(s => s.id === rule.targetId);
          if (target) result.push(target);
        }
        break;
      }
      case "exclude_section": {
        result = result.filter(s => s.id !== rule.targetId);
        break;
      }
      case "replace_clause": {
        // targetId deve ser "sectionId:clauseId" — neste sprint aplica a qualquer seção
        result = result.map(section => ({
          ...section,
          clauses: section.clauses.filter(c => c.id !== rule.targetId),
        }));
        break;
      }
      case "append_clause": {
        // Sem implementação de payload neste sprint (requer extensão futura)
        break;
      }
    }
  }

  // Ordena seções por order ASC
  return result.sort((a, b) => a.order - b.order);
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function createClause(
  type:    ClauseType,
  content: string,
  params: {
    legalBasis?:      string;
    clauseProvenance?: ExtractionProvenance;
    isRequired?:      boolean;
    fallback?:        TRClause | null;
    dependsOn?:       string[];
  } = {},
): TRClause {
  return {
    id:               nanoid(),
    type,
    content,
    legalBasis:       params.legalBasis,
    clauseProvenance: params.clauseProvenance,
    isRequired:       params.isRequired ?? true,
    fallback:         params.fallback ?? null,
    dependsOn:        params.dependsOn ?? [],
  };
}

export function createSection(
  title:   string,
  clauses: TRClause[],
  order:   number,
  params: {
    isOptional?:        boolean;
    conditionalBlocks?: TRConditionalBlock[];
  } = {},
): TRSection {
  return {
    id:                nanoid(),
    title,
    clauses,
    order,
    isOptional:        params.isOptional ?? false,
    conditionalBlocks: params.conditionalBlocks ?? [],
  };
}
