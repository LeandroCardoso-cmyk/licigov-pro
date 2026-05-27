/**
 * Sprint 2 — Modelo estruturado oficial de documentos do LiciGov Pro.
 *
 * Documentos NÃO são campos texto. São aggregates estruturados com
 * sections, blocks, variables e metadata para rastreabilidade e IA readiness.
 */

// ─── Document Types ───────────────────────────────────────────────────────────

export type DocumentTypeValue =
  | "etp"            // Estudo Técnico Preliminar
  | "tr"             // Termo de Referência
  | "dfd"            // Documento de Formalização de Demanda
  | "edital"         // Edital de Licitação
  | "contrato"       // Contrato
  | "ata"            // Ata de Registro de Preços
  | "parecer"        // Parecer Jurídico
  | "aditivo"        // Termo Aditivo
  | "minuta";        // Minuta de Contrato/Edital

export const DOCUMENT_TYPE_LABELS: Record<DocumentTypeValue, string> = {
  etp:     "Estudo Técnico Preliminar",
  tr:      "Termo de Referência",
  dfd:     "Documento de Formalização de Demanda",
  edital:  "Edital de Licitação",
  contrato:"Contrato",
  ata:     "Ata de Registro de Preços",
  parecer: "Parecer Jurídico",
  aditivo: "Termo Aditivo",
  minuta:  "Minuta",
};

// ─── Workflow ─────────────────────────────────────────────────────────────────

export type DocumentStatusValue =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "archived";

/** Mapa oficial de transições permitidas no workflow documental */
export const WORKFLOW_TRANSITIONS: Record<DocumentStatusValue, DocumentStatusValue[]> = {
  draft:     ["in_review", "archived"],
  in_review: ["approved", "rejected"],
  approved:  ["archived"],
  rejected:  ["draft", "archived"],
  archived:  [],  // estado terminal
};

/** Verifica se uma transição de estado é permitida */
export function isValidTransition(
  from: DocumentStatusValue,
  to: DocumentStatusValue,
): boolean {
  return WORKFLOW_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Role mínimo exigido por transição */
export const WORKFLOW_ROLE_REQUIREMENTS: Partial<Record<DocumentStatusValue, string>> = {
  in_review: "operator",  // submeter para revisão
  approved:  "manager",   // aprovar
  rejected:  "manager",   // rejeitar
  archived:  "manager",   // arquivar
  draft:     "operator",  // retornar a rascunho
};

// ─── Structured Content ───────────────────────────────────────────────────────

export type DocumentSectionType =
  | "introduction"
  | "justification"
  | "legal_basis"
  | "scope"
  | "technical_requirements"
  | "commercial_conditions"
  | "timeline"
  | "conclusion"
  | "custom";

export type DocumentBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "table"
  | "clause"
  | "variable_ref"
  | "legal_citation"
  | "attachment_ref";

export interface DocumentBlock {
  id: string;
  type: DocumentBlockType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentSection {
  id: string;
  type: DocumentSectionType;
  title: string;
  order: number;
  required: boolean;
  blocks: DocumentBlock[];
}

export type DocumentVariableType = "text" | "number" | "date" | "currency" | "cnpj" | "reference";

export interface DocumentVariable {
  key: string;
  label: string;
  value: string | null;
  type: DocumentVariableType;
  required: boolean;
  placeholder?: string;
}

export interface DocumentMetadataFields {
  legalBasis?: string;
  estimatedValueCents?: number;
  estimatedExecutionDays?: number;
  category?: string;
  modality?: string;
  wordCount?: number;
  completionPercentage?: number;
  reviewerIds?: number[];
  tags?: string[];
  exportFormat?: "docx" | "pdf" | "html";
}

export interface StructuredDocumentContent {
  schemaVersion: number;
  title: string;
  sections: DocumentSection[];
  variables: DocumentVariable[];
  metadata: DocumentMetadataFields;
}

// ─── Snapshots (stored in JSON columns) ──────────────────────────────────────

export interface ActorSnapshot {
  userId: number;
  name: string;
  email: string;
  role: string;
  orgId: number;
  orgName: string;
}

export interface WorkflowSnapshot {
  fromState: DocumentStatusValue;
  toState: DocumentStatusValue;
  reason?: string;
  timestamp: string;
}

// ─── Version source context ───────────────────────────────────────────────────

export type VersionSourceContext =
  | "manual"
  | "autosave_publish"
  | "ai"
  | "import"
  | "restore"
  | "workflow";

// ─── Timeline event types ─────────────────────────────────────────────────────

export type DocumentTimelineEventType =
  | "documento_criado"
  | "documento_editado"
  | "versao_criada"
  | "versao_restaurada"
  | "draft_salvo"
  | "draft_publicado"
  | "draft_descartado"
  | "comentario_adicionado"
  | "comentario_resolvido"
  | "revisao_solicitada"
  | "documento_aprovado"
  | "documento_rejeitado"
  | "retornado_rascunho"
  | "documento_arquivado"
  | "documento_bloqueado"
  | "documento_desbloqueado"
  | "workflow_alterado"
  | "anexo_adicionado"
  | "anexo_removido"
  | "integridade_verificada"
  | "lock_adquirido"
  | "lock_liberado"
  | "render_gerado";

// ─── Export foundation ────────────────────────────────────────────────────────

export type ExportFormat = "html" | "docx" | "pdf";

export interface ExportPipelineOptions {
  format: ExportFormat;
  includeMetadata?: boolean;
  includeTimeline?: boolean;
  pageSize?: "A4" | "Letter";
  locale?: "pt-BR" | "en-US";
}

export interface ExportResult {
  format: ExportFormat;
  content: string;      // base64 para binários, UTF-8 para html
  mimeType: string;
  filename: string;
  generatedAt: Date;
}

export function buildExportFilename(
  documentType: DocumentTypeValue,
  title: string,
  format: ExportFormat,
): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const ext  = format === "docx" ? "docx" : format === "pdf" ? "pdf" : "html";
  return `${documentType}-${slug}.${ext}`;
}
