import { createHash } from "crypto";
import {
  type DraftTemplate,
  type DraftGeneration,
  type DraftVariable,
  createDraftTemplate,
  createDraftSection,
  createDraftBlock,
  createDraftVariable,
  generateDraft,
  validateDraftCompleteness,
  extractTemplateSkeleton,
} from "../domain/documentDrafting";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DraftingEngineInput {
  organizationId: number;
  sessionId: string;
  documentType: string;
  variableValues: Record<string, string>;
  templateId?: string;
  legalFramework?: string;
}

export interface DraftingEngineOutput {
  generation: DraftGeneration;
  template: DraftTemplate;
  completeness: { isComplete: boolean; missingRequired: string[]; completenessScore: number };
  skeleton: string;
  processingMs: number;
  replayKey: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _draftTemplates = new Map<number, Map<string, DraftTemplate>>();
const _draftHistory = new Map<number, DraftingEngineOutput[]>();

// ─── Default templates ────────────────────────────────────────────────────────

function buildDefaultTemplate(organizationId: number, documentType: string, legalFramework: string): DraftTemplate {
  const sections = [
    createDraftSection({
      organizationId,
      title: "Identificação e Objeto",
      order: 1,
      legalBasis: `${legalFramework} art. 6º`,
      blocks: [
        createDraftBlock({ organizationId, blockType: "header", content: "{{TITULO_DOCUMENTO}}", order: 1, isRequired: true }),
        createDraftBlock({ organizationId, blockType: "paragraph", content: "Objeto: {{OBJETO_CONTRATO}}. Órgão: {{ORGAO_CONTRATANTE}}.", order: 2, isRequired: true, legalBasis: `${legalFramework} art. 92` }),
      ],
    }),
    createDraftSection({
      organizationId,
      title: "Fundamento Legal",
      order: 2,
      legalBasis: legalFramework,
      blocks: [
        createDraftBlock({ organizationId, blockType: "legal_ref", content: "Fundamenta-se no {{FUNDAMENTO_LEGAL}}, conforme previsto na {{LEI_REFERENCIA}}.", order: 1, isRequired: true }),
      ],
    }),
    createDraftSection({
      organizationId,
      title: "Especificações",
      order: 3,
      isOptional: true,
      blocks: [
        createDraftBlock({ organizationId, blockType: "paragraph", content: "{{ESPECIFICACOES_TECNICAS}}", order: 1, isRequired: false }),
      ],
    }),
    createDraftSection({
      organizationId,
      title: "Valor e Vigência",
      order: 4,
      legalBasis: `${legalFramework} art. 105`,
      blocks: [
        createDraftBlock({ organizationId, blockType: "clause", content: "Valor estimado: {{VALOR_ESTIMADO}}. Vigência: {{PRAZO_VIGENCIA}}.", order: 1, isRequired: true }),
      ],
    }),
    createDraftSection({
      organizationId,
      title: "Assinaturas",
      order: 5,
      blocks: [
        createDraftBlock({ organizationId, blockType: "signature", content: "{{LOCAL_DATA}}\n\n{{NOME_RESPONSAVEL}}\n{{CARGO_RESPONSAVEL}}", order: 1, isRequired: true }),
      ],
    }),
  ];

  const variables: DraftVariable[] = [
    createDraftVariable({ name: "TITULO_DOCUMENTO", label: "Título do Documento", required: true }),
    createDraftVariable({ name: "OBJETO_CONTRATO", label: "Objeto do Contrato", required: true }),
    createDraftVariable({ name: "ORGAO_CONTRATANTE", label: "Órgão Contratante", required: true }),
    createDraftVariable({ name: "FUNDAMENTO_LEGAL", label: "Fundamento Legal", required: true }),
    createDraftVariable({ name: "LEI_REFERENCIA", label: "Lei de Referência", required: true, defaultValue: legalFramework }),
    createDraftVariable({ name: "ESPECIFICACOES_TECNICAS", label: "Especificações Técnicas", required: false }),
    createDraftVariable({ name: "VALOR_ESTIMADO", label: "Valor Estimado", required: true }),
    createDraftVariable({ name: "PRAZO_VIGENCIA", label: "Prazo de Vigência", required: true }),
    createDraftVariable({ name: "LOCAL_DATA", label: "Local e Data", required: true }),
    createDraftVariable({ name: "NOME_RESPONSAVEL", label: "Nome do Responsável", required: true }),
    createDraftVariable({ name: "CARGO_RESPONSAVEL", label: "Cargo do Responsável", required: true }),
  ];

  return createDraftTemplate({
    organizationId,
    name: `Template Padrão — ${documentType}`,
    documentType,
    sections,
    variables,
    legalFramework,
  });
}

// ─── Service functions ────────────────────────────────────────────────────────

export function registerTemplate(template: DraftTemplate): void {
  const orgMap = _draftTemplates.get(template.organizationId) ?? new Map();
  orgMap.set(template.id, template);
  _draftTemplates.set(template.organizationId, orgMap);
}

export function getTemplate(organizationId: number, templateId: string): DraftTemplate | null {
  return _draftTemplates.get(organizationId)?.get(templateId) ?? null;
}

export function runDocumentDrafting(input: DraftingEngineInput): DraftingEngineOutput {
  const start = Date.now();
  const { organizationId, sessionId, documentType, variableValues, legalFramework = "Lei 14133/2021" } = input;

  let template: DraftTemplate;
  if (input.templateId) {
    template = getTemplate(organizationId, input.templateId) ?? buildDefaultTemplate(organizationId, documentType, legalFramework);
  } else {
    template = buildDefaultTemplate(organizationId, documentType, legalFramework);
    registerTemplate(template);
  }

  const generation = generateDraft(template, variableValues, sessionId);
  const completeness = validateDraftCompleteness(generation, template);
  const skeleton = extractTemplateSkeleton(template);

  const sha256 = (x: string) => createHash("sha256").update(x, "utf8").digest("hex");
  const replayKey = sha256(JSON.stringify({
    organizationId,
    sessionId,
    templateId: template.id,
    variableValues: Object.fromEntries(Object.entries(variableValues).sort()),
  }));

  const output: DraftingEngineOutput = {
    generation,
    template,
    completeness,
    skeleton,
    processingMs: Date.now() - start,
    replayKey,
  };

  const existing = _draftHistory.get(organizationId) ?? [];
  _draftHistory.set(organizationId, [...existing, output]);
  return output;
}

export function getDraftHistory(organizationId: number): DraftingEngineOutput[] {
  return _draftHistory.get(organizationId) ?? [];
}

export function replayDrafting(output: DraftingEngineOutput, newVariables?: Record<string, string>): DraftingEngineOutput {
  return runDocumentDrafting({
    organizationId: output.generation.organizationId,
    sessionId: output.generation.sessionId,
    documentType: output.template.documentType,
    variableValues: newVariables ?? output.generation.variableValues,
    templateId: output.template.id,
    legalFramework: output.template.legalFramework,
  });
}
