/**
 * Sprint 4.3 — Document Drafting Domain.
 *
 * Motor de geração e renderização de documentos (TR, ETP, contratos, atas, editais,
 * pareceres, justificativas) baseado em templates estruturados com variáveis,
 * seções condicionais e blocos tipados.
 *
 * PRINCÍPIOS:
 *   - Determinismo: replayKey garante idempotência de geração.
 *   - Imutabilidade: funções retornam novos objetos (nunca mutam entradas).
 *   - Lineage: toda geração registra sua cadeia de derivação.
 *   - Proveniência: base legal explícita por bloco e template.
 *   - Multi-tenant: organizationId obrigatório.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DraftStageType =
  | "outline"
  | "section_assembly"
  | "clause_insertion"
  | "variable_interpolation"
  | "legal_injection"
  | "review"
  | "finalization";

export type DraftStatus = "draft" | "review" | "approved" | "rejected" | "archived";

export type BlockType =
  | "heading"
  | "header"
  | "paragraph"
  | "list"
  | "table"
  | "clause"
  | "signature"
  | "legal_ref"
  | "legal_basis"
  | "justification"
  | "specification"
  | "table_of_contents"
  | "signature_block";

export type DraftVariableType = "string" | "number" | "date" | "currency" | "cnpj" | "enum";

export interface DraftTemplateLegacy {
  id: string;
  organizationId: number;
  templateKey: string;
  name: string;
  documentType: "TR" | "ETP" | "contrato" | "ata" | "edital" | "parecer" | "justificativa";
  sections: DraftSectionLegacy[];
  variables: DraftVariableLegacy[];
  legalBasis: string[];
  version: string;
  replayKey: string;
  createdBy: number;
  createdAt: string;
}

export interface DraftSectionLegacy {
  id: string;
  organizationId: number;
  templateId: string;
  title: string;
  order: number;
  blocks: DraftBlockLegacy[];
  isRequired: boolean;
  condition: string | null;   // expressão condicional
  legalRef: string | null;
  replayKey: string;
}

export interface DraftBlockLegacy {
  id: string;
  blockType: BlockType;
  content: string;            // template com {{variables}}
  order: number;
  legalBasis: string | null;
  isRequired: boolean;
  evidence: DraftEvidence | null;
  replayKey: string;
}

export interface DraftVariableLegacy {
  id: string;
  name: string;               // ex: "objeto"
  label: string;              // ex: "Objeto da Contratação"
  variableType: DraftVariableType;
  isRequired: boolean;
  defaultValue: string | null;
  validationPattern: string | null;
  legalRef: string | null;
}

export interface DraftEvidence {
  sourceRef: string;
  content: string;
  authority: number;
  isVerified: boolean;
}

export interface DraftConstraint {
  id: string;
  constraintType: "max_length" | "required_section" | "forbidden_content" | "legal_compliance" | "format";
  description: string;
  targetSection: string | null;
  targetBlock: string | null;
  errorMessage: string;
}

export interface DraftRecommendation {
  id: string;
  organizationId: number;
  draftId: string;
  recommendationType: "add_clause" | "strengthen_justification" | "cite_precedent" | "improve_specificity" | "add_legal_basis";
  description: string;
  targetSection: string | null;
  legalBasis: string | null;
  confidence: number;
  replayKey: string;
}

export interface DraftGenerationLegacy {
  id: string;
  organizationId: number;
  templateId: string;
  documentType: DraftTemplateLegacy["documentType"];
  status: DraftStatus;
  variables: Record<string, string>;
  renderedSections: RenderedSection[];
  totalWordCount: number;
  legalBasisUsed: string[];
  constraintViolations: DraftConstraint[];
  recommendations: DraftRecommendation[];
  lineage: string[];
  replayKey: string;
  generatedAt: string;
}

export interface RenderedSection {
  sectionId: string;
  title: string;
  order: number;
  renderedContent: string;
  wordCount: number;
  legalRef: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function deterministicId(input: string): string {
  return sha256Hex(input).slice(0, 20);
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0).length;
}

/**
 * Avalia uma condição simples de variável (ex: "variables.requiresWarranty == 'true'").
 * Suporta apenas comparações de igualdade de variáveis de template.
 * Retorna true para condições não reconhecidas (permissivo por padrão).
 */
function evaluateSectionCondition(
  condition: string | null,
  variables: Record<string, string>,
): boolean {
  if (!condition) return true;

  // Formato suportado: "varName == 'value'" ou "varName != 'value'"
  const eqMatch = /^(\w+)\s*==\s*'([^']*)'$/.exec(condition.trim());
  if (eqMatch) {
    return (variables[eqMatch[1]] ?? "") === eqMatch[2];
  }
  const neqMatch = /^(\w+)\s*!=\s*'([^']*)'$/.exec(condition.trim());
  if (neqMatch) {
    return (variables[neqMatch[1]] ?? "") !== neqMatch[2];
  }

  // Condição não reconhecida → inclui a seção por precaução
  return true;
}

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Cria um DraftTemplate vazio (sem seções nem variáveis).
 * replayKey = sha256(templateKey + documentType + organizationId)
 */
export function createDraftTemplateLegacy(params: {
  organizationId: number;
  templateKey: string;
  name: string;
  documentType: DraftTemplateLegacy["documentType"];
  legalBasis?: string[];
  createdBy: number;
}): DraftTemplateLegacy {
  const replayKey = sha256Hex(
    `${params.templateKey}${params.documentType}${params.organizationId}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    organizationId: params.organizationId,
    templateKey:    params.templateKey,
    name:           params.name,
    documentType:   params.documentType,
    sections:       [],
    variables:      [],
    legalBasis:     params.legalBasis ?? [],
    version:        "1.0.0",
    replayKey,
    createdBy:      params.createdBy,
    createdAt:      new Date().toISOString(),
  };
}

/**
 * Cria uma DraftSection sem blocos.
 * replayKey = sha256(templateId + title + order.toString())
 */
export function createDraftSectionLegacy(params: {
  organizationId: number;
  templateId: string;
  title: string;
  order: number;
  isRequired?: boolean;
  condition?: string | null;
  legalRef?: string | null;
}): DraftSectionLegacy {
  const replayKey = sha256Hex(
    `${params.templateId}${params.title}${params.order.toString()}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    organizationId: params.organizationId,
    templateId:     params.templateId,
    title:          params.title,
    order:          params.order,
    blocks:         [],
    isRequired:     params.isRequired ?? true,
    condition:      params.condition ?? null,
    legalRef:       params.legalRef ?? null,
    replayKey,
  };
}

/**
 * Cria um DraftBlock com conteúdo template.
 * replayKey = sha256(blockType + content + order.toString())
 */
export function createDraftBlockLegacy(params: {
  blockType: BlockType;
  content: string;
  order: number;
  legalBasis?: string | null;
  isRequired?: boolean;
}): DraftBlockLegacy {
  const replayKey = sha256Hex(
    `${params.blockType}${params.content}${params.order.toString()}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    blockType:  params.blockType,
    content:    params.content,
    order:      params.order,
    legalBasis: params.legalBasis ?? null,
    isRequired: params.isRequired ?? true,
    evidence:   null,
    replayKey,
  };
}

/**
 * Interpola variáveis {{variableName}} no conteúdo do template.
 * Retorna conteúdo renderizado, variáveis usadas e variáveis ausentes.
 */
export function interpolateVariables(
  content: string,
  variables: Record<string, string>,
): { rendered: string; variablesUsed: string[]; missingVariables: string[] } {
  const variablesUsed: string[]   = [];
  const missingVariables: string[] = [];

  const rendered = content.replace(/\{\{([^}]+)\}\}/g, (_match, varName: string) => {
    const key = varName.trim();
    if (Object.prototype.hasOwnProperty.call(variables, key) && variables[key] !== undefined) {
      if (!variablesUsed.includes(key)) variablesUsed.push(key);
      return variables[key];
    }
    if (!missingVariables.includes(key)) missingVariables.push(key);
    return `{{${key}}}`;
  });

  return { rendered, variablesUsed, missingVariables };
}

/**
 * Monta as seções renderizadas de um template com variáveis interpoladas.
 * Seções condicionais são filtradas. Seções são ordenadas por `order`.
 */
export function assembleSections(
  template: DraftTemplateLegacy,
  variables: Record<string, string>,
): RenderedSection[] {
  const sorted = [...template.sections].sort((a, b) => a.order - b.order);
  const rendered: RenderedSection[] = [];

  for (const section of sorted) {
    if (!evaluateSectionCondition(section.condition, variables)) continue;

    const blockContents: string[] = [];
    const sortedBlocks = [...section.blocks].sort((a, b) => a.order - b.order);

    for (const block of sortedBlocks) {
      const { rendered: blockRendered } = interpolateVariables(block.content, variables);
      blockContents.push(blockRendered);
    }

    const renderedContent = blockContents.join("\n\n");

    rendered.push({
      sectionId:       section.id,
      title:           section.title,
      order:           section.order,
      renderedContent,
      wordCount:       countWords(renderedContent),
      legalRef:        section.legalRef,
    });
  }

  return rendered;
}

/**
 * Renderiza um draft completo a partir de template e variáveis.
 * replayKey = sha256(template.id + sorted(Object.keys(variables)).join + organizationId)
 */
export function renderDraft(
  template: DraftTemplateLegacy,
  variables: Record<string, string>,
  organizationId: number,
): DraftGenerationLegacy {
  const renderedSections = assembleSections(template, variables);
  const totalWordCount   = renderedSections.reduce((acc, s) => acc + s.wordCount, 0);

  const sortedVarKeys = Object.keys(variables).sort().join("|");
  const replayKey = sha256Hex(
    `${template.id}${sortedVarKeys}${organizationId}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    organizationId,
    templateId:          template.id,
    documentType:        template.documentType,
    status:              "draft",
    variables:           { ...variables },
    renderedSections,
    totalWordCount,
    legalBasisUsed:      [...template.legalBasis],
    constraintViolations: [],
    recommendations:     [],
    lineage:             [],
    replayKey,
    generatedAt:         new Date().toISOString(),
  };
}

/**
 * Valida constraints de um draft e retorna apenas as violadas.
 * - "required_section": verifica se seção tem conteúdo não-vazio
 * - "max_length": verifica wordCount total (targetSection = limite numérico em description)
 * - "forbidden_content": busca keywords proibidas no conteúdo renderizado
 */
export function validateDraftConstraints(
  draft: DraftGenerationLegacy,
  constraints: DraftConstraint[],
): DraftConstraint[] {
  const violated: DraftConstraint[] = [];
  const allContent = draft.renderedSections.map(s => s.renderedContent).join("\n").toLowerCase();

  for (const constraint of constraints) {
    switch (constraint.constraintType) {
      case "required_section": {
        const targetId = constraint.targetSection;
        if (!targetId) break;
        const section = draft.renderedSections.find(s => s.sectionId === targetId);
        if (!section || section.wordCount === 0) violated.push(constraint);
        break;
      }
      case "max_length": {
        // description carrega o limite como número (ex: "500")
        const limitStr = constraint.description.match(/\d+/)?.[0];
        if (!limitStr) break;
        const limit = parseInt(limitStr, 10);
        if (draft.totalWordCount > limit) violated.push(constraint);
        break;
      }
      case "forbidden_content": {
        // targetBlock carrega a keyword proibida
        const keyword = constraint.targetBlock?.toLowerCase();
        if (!keyword) break;
        if (allContent.includes(keyword)) violated.push(constraint);
        break;
      }
      default:
        // Outros tipos não violam por padrão (simplificado)
        break;
    }
  }

  return violated;
}

/**
 * Computa hash do conteúdo renderizado de um draft.
 * sha256(draft.replayKey + draft.renderedSections.map(s=>s.renderedContent).join)
 */
export function computeDraftHash(draft: DraftGenerationLegacy): string {
  const contentJoined = draft.renderedSections.map(s => s.renderedContent).join("|");
  return sha256Hex(`${draft.replayKey}${contentJoined}`);
}

/**
 * Constrói a lineage de uma revisão, adicionando o ID da geração original.
 * Retorna novo array append-only.
 */
export function buildDraftLineage(
  original: DraftGenerationLegacy,
  _revision: DraftGenerationLegacy,
): string[] {
  return [...original.lineage, original.id];
}

// ─── Sprint 4.3: Extended Drafting Types & Variable Engine ───────────────────

export type VariableType = "text" | "number" | "date" | "boolean" | "enum" | "reference";

export interface DraftVariableV2 {
  id: string;
  name: string;            // e.g. "{{OBJETO_CONTRATO}}"
  label: string;           // human-readable
  type: VariableType;
  required: boolean;
  defaultValue: string | null;
  enumValues: string[] | null;
  description: string;
  legalBasis: string | null;
}

export interface DraftBlockV2 {
  id: string;
  organizationId: number;
  blockType: BlockType;
  content: string;         // may contain {{VARIABLE}} placeholders
  legalBasis: string | null;
  order: number;
  isRequired: boolean;
  variables: string[];     // variable names used in this block
  conditions: string[];    // condition expressions for conditional inclusion
  fallback: string | null; // content if block removed due to conditions
}

export interface DraftSectionV2 {
  id: string;
  organizationId: number;
  title: string;
  blocks: DraftBlockV2[];
  order: number;
  isOptional: boolean;
  legalBasis: string | null;
  conditionExpression: string | null;
}

export interface DraftTemplateV2 {
  id: string;
  organizationId: number;
  name: string;
  documentType: string;     // e.g. "edital_pregao", "contrato_servico", "tr"
  sections: DraftSectionV2[];
  variables: DraftVariableV2[];
  version: string;
  legalFramework: string;   // e.g. "Lei 14133/2021"
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DraftGenerationV2 {
  id: string;
  organizationId: number;
  sessionId: string;
  templateId: string;
  resolvedContent: string;  // full rendered document
  resolvedSections: Array<{ sectionId: string; title: string; renderedContent: string }>;
  variableValues: Record<string, string>;
  missingVariables: string[];
  generationScore: number;  // 0-1 completeness
  legalBasisRefs: string[];
  replayKey: string;
  generatedAt: string;
}

// ─── Sprint 4.3: Factory functions ───────────────────────────────────────────

export function createDraftVariableV2(params: {
  name: string;
  label: string;
  type?: VariableType;
  variableType?: VariableType;     // test-compat alias for type
  required?: boolean;
  isRequired?: boolean;            // test-compat alias for required
  defaultValue?: string | null;
  enumValues?: string[] | null;
  description?: string;
  legalBasis?: string | null;
}): DraftVariableV2 & { isRequired: boolean } {
  const id = sha256Hex(`draftvar:${params.name}:${params.label}`).slice(0, 20);
  const required = params.isRequired ?? params.required ?? false;
  return {
    id,
    name: params.name,
    label: params.label,
    type: params.variableType ?? params.type ?? "text",
    required,
    isRequired: required,
    defaultValue: params.defaultValue ?? null,
    enumValues: params.enumValues ?? null,
    description: params.description ?? "",
    legalBasis: params.legalBasis ?? null,
  };
}

export function createDraftBlockV2(params: {
  organizationId?: number;         // optional for test-compat
  blockType?: BlockType;
  content: string;
  legalBasis?: string | null;
  order?: number;
  isRequired?: boolean;
  variables?: string[];
  conditions?: string[];
  fallback?: string | null;
}): DraftBlockV2 & { extractedVariables: string[] } {
  // Auto-extract variables: match {{WORD}} case-insensitive
  const autoExtracted = (params.content.match(/\{\{([A-Za-z0-9_]+)\}\}/g) ?? [])
    .map(m => m.slice(2, -2));
  const variables = params.variables ?? autoExtracted;
  const orgId = params.organizationId ?? 0;

  const id = sha256Hex(`draftblockv2:${orgId}:${params.content}:${params.order ?? 0}`).slice(0, 20);
  return {
    id,
    organizationId: orgId,
    blockType: params.blockType ?? "paragraph",
    content: params.content,
    legalBasis: params.legalBasis ?? null,
    order: params.order ?? 0,
    isRequired: params.isRequired ?? true,
    variables,
    extractedVariables: autoExtracted,
    conditions: params.conditions ?? [],
    fallback: params.fallback ?? null,
  };
}

export function createDraftSectionV2(params: {
  organizationId: number;
  title: string;
  blocks?: DraftBlockV2[];
  order?: number;
  isOptional?: boolean;
  legalBasis?: string | null;
  conditionExpression?: string | null;
  templateId?: string;             // test-compat — ignored
}): DraftSectionV2 {
  const id = sha256Hex(`draftsectionv2:${params.organizationId}:${params.title}:${params.order ?? 0}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    title: params.title,
    blocks: params.blocks ?? [],
    order: params.order ?? 0,
    isOptional: params.isOptional ?? false,
    legalBasis: params.legalBasis ?? null,
    conditionExpression: params.conditionExpression ?? null,
  };
}

export function createDraftTemplateV2(params: {
  organizationId: number;
  name: string;
  documentType: string;
  sections?: DraftSectionV2[];
  variables?: DraftVariableV2[];
  version?: string;
  legalFramework?: string;
  templateKey?: string;            // test-compat — ignored
  createdBy?: number;              // test-compat — ignored
}): DraftTemplateV2 {
  const now = new Date().toISOString();
  const id = sha256Hex(`drafttemplv2:${params.organizationId}:${params.name}:${params.documentType}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    name: params.name,
    documentType: params.documentType,
    sections: params.sections ?? [],
    variables: params.variables ?? [],
    version: params.version ?? "1.0.0",
    legalFramework: params.legalFramework ?? "Lei 14133/2021",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function resolveDraftVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, varName: string) => {
    return Object.prototype.hasOwnProperty.call(values, varName) ? values[varName] : `{{${varName}}}`;
  });
}

export function generateDraftV2(
  templateOrObj: DraftTemplateV2 | { template: DraftTemplateV2; variableValues: Record<string, string>; sessionId: string; organizationId?: number },
  variableValues?: Record<string, string>,
  sessionId?: string,
): DraftGenerationV2 {
  // Support both positional (template, values, sessionId) and object ({ template, variableValues, sessionId }) styles
  let template: DraftTemplateV2;
  let vals: Record<string, string>;
  let sid: string;
  if (templateOrObj && typeof templateOrObj === "object" && "template" in templateOrObj) {
    template = templateOrObj.template;
    vals = templateOrObj.variableValues;
    sid = templateOrObj.sessionId;
  } else {
    template = templateOrObj as DraftTemplateV2;
    vals = variableValues ?? {};
    sid = sessionId ?? "default";
  }
  return _generateDraftV2Impl(template, vals, sid);
}

function _generateDraftV2Impl(
  template: DraftTemplateV2,
  variableValues: Record<string, string>,
  sessionId: string,
): DraftGenerationV2 {
  const now = new Date().toISOString();
  const resolvedSections: DraftGenerationV2["resolvedSections"] = [];
  const missingVariables: string[] = [];
  const legalBasisSet = new Set<string>();

  // Collect legalBasis refs from all blocks
  for (const section of template.sections) {
    if (section.legalBasis) legalBasisSet.add(section.legalBasis);
    const blockContents: string[] = [];
    for (const block of [...section.blocks].sort((a, b) => a.order - b.order)) {
      if (block.legalBasis) legalBasisSet.add(block.legalBasis);
      const rendered = resolveDraftVariables(block.content, variableValues);
      // Track missing vars in this block
      const blockMissing = (rendered.match(/\{\{([A-Z0-9_]+)\}\}/g) ?? []).map(m => m.slice(2, -2));
      for (const mv of blockMissing) {
        if (!missingVariables.includes(mv)) missingVariables.push(mv);
      }
      blockContents.push(rendered);
    }
    resolvedSections.push({
      sectionId: section.id,
      title: section.title,
      renderedContent: blockContents.join("\n\n"),
    });
  }

  const resolvedContent = resolvedSections
    .map(s => `## ${s.title}\n\n${s.renderedContent}`)
    .join("\n\n");

  // generationScore = resolvedVars / totalRequiredVars (or 1.0 if no required vars)
  const requiredVars = template.variables.filter(v => v.required).map(v => v.name);
  const generationScore = requiredVars.length === 0
    ? 1.0
    : requiredVars.filter(v => !missingVariables.includes(v)).length / requiredVars.length;

  const sortedVarKeys = Object.keys(variableValues).sort();
  const replayKey = sha256Hex(JSON.stringify({
    templateId: template.id,
    variableValues: Object.fromEntries(sortedVarKeys.map(k => [k, variableValues[k]])),
    sessionId,
  })).slice(0, 40);

  const id = sha256Hex(`draftgenv2:${template.id}:${sessionId}:${now}`).slice(0, 20);

  return {
    id,
    organizationId: template.organizationId,
    sessionId,
    templateId: template.id,
    resolvedContent,
    resolvedSections,
    variableValues: { ...variableValues },
    missingVariables,
    generationScore: Math.min(1, Math.max(0, generationScore)),
    legalBasisRefs: Array.from(legalBasisSet),
    replayKey,
    generatedAt: now,
  };
}

export function extractTemplateSkeleton(template: DraftTemplateV2): string {
  const lines: string[] = [`# ${template.name} (${template.documentType})`, ``];
  for (const section of [...template.sections].sort((a, b) => a.order - b.order)) {
    lines.push(`## ${section.title}`);
    for (const block of [...section.blocks].sort((a, b) => a.order - b.order)) {
      lines.push(`  - [${block.blockType}]`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

export function validateDraftCompletenessV2(
  generationOrTemplate: DraftGenerationV2 | DraftTemplateV2,
  templateOrValues: DraftTemplateV2 | Record<string, string>,
): { isComplete: boolean; missingRequired: string[]; completenessScore: number } {
  // Detect (template, variableValues) call style vs (generation, template) style
  if ("missingVariables" in generationOrTemplate) {
    // Normal style: (generation, template)
    const generation = generationOrTemplate as DraftGenerationV2;
    const template = templateOrValues as DraftTemplateV2;
    const requiredVars = (template.variables ?? []).filter(v => v.required || (v as unknown as { isRequired?: boolean }).isRequired).map(v => v.name);
    const missingRequired = requiredVars.filter(v => !generation.variableValues || generation.missingVariables.includes(v));
    const completenessScore = requiredVars.length === 0
      ? 1.0
      : (requiredVars.length - missingRequired.length) / requiredVars.length;
    return {
      isComplete: missingRequired.length === 0,
      missingRequired,
      completenessScore: Math.min(1, Math.max(0, completenessScore)),
    };
  } else {
    // Test-compat style: (template, variableValues)
    const template = generationOrTemplate as DraftTemplateV2;
    const vals = (templateOrValues ?? {}) as Record<string, string>;
    const requiredVars = (template.variables ?? []).filter(v => v.required || (v as unknown as { isRequired?: boolean }).isRequired).map(v => v.name);
    const missingRequired = requiredVars.filter(v => vals[v] == null || String(vals[v]).trim() === "");
    const completenessScore = requiredVars.length === 0
      ? 1.0
      : (requiredVars.length - missingRequired.length) / requiredVars.length;
    return {
      isComplete: missingRequired.length === 0,
      missingRequired,
      completenessScore: Math.min(1, Math.max(0, completenessScore)),
    };
  }
}

// ─── Sprint 4.3: Canonical-name aliases for document drafting service layer ───

/** Sprint 4.3 DraftVariable type (with name, label, type, required, defaultValue, enumValues) */
export type DraftVariable = DraftVariableV2;

/** Sprint 4.3 DraftTemplate type (with name, documentType, sections, variables, legalFramework) */
export type DraftTemplateV3 = DraftTemplateV2;

/** Sprint 4.3 DraftGeneration type (with sessionId, variableValues, resolvedContent) */
export type DraftGenerationV3 = DraftGenerationV2;

/** Sprint 4.3 canonical DraftTemplate (service layer uses this type) */
export type DraftTemplate = DraftTemplateV2;

/** Sprint 4.3 canonical DraftGeneration (service layer uses this type) */
export type DraftGeneration = DraftGenerationV2;

/** Sprint 4.3 canonical DraftSection (service layer uses this type) */
export type DraftSection = DraftSectionV2;

/** Sprint 4.3 canonical DraftBlock (service layer uses this type) */
export type DraftBlock = DraftBlockV2;

/** @alias createDraftVariableV2 */
export const createDraftVariable = createDraftVariableV2;

/** @alias generateDraftV2 */
export const generateDraft = generateDraftV2;

/** @alias validateDraftCompletenessV2 */
export const validateDraftCompleteness = validateDraftCompletenessV2;

/** @alias createDraftSectionV2 — Sprint 4.3 signature with organizationId, legalBasis, isOptional, blocks */
export const createDraftSection = createDraftSectionV2;

/** @alias createDraftBlockV2 — Sprint 4.3 signature with organizationId, variables, conditions */
export const createDraftBlock = createDraftBlockV2;

/** @alias createDraftTemplateV2 — Sprint 4.3 signature with legalFramework, isActive */
export const createDraftTemplate = createDraftTemplateV2;
