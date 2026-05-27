/**
 * Sprint 2 — Contratos oficiais de Domain Events do Core Documental.
 *
 * Todos os eventos usam o contrato DomainEvent da Sprint 1.8 para garantir:
 * rastreabilidade, correlationId propagation, tenant context, replay safety.
 */
import type { DomainEvent } from "./events";
import type { DocumentTypeValue, DocumentStatusValue } from "./documentTypes";

// ─── Payloads ─────────────────────────────────────────────────────────────────

export interface DocumentoCriadoPayload {
  documentId: number;
  processId: number;
  documentType: DocumentTypeValue;
  title: string | null;
  createdBy: number;
}

export interface DocumentoAtualizadoPayload {
  documentId: number;
  processId: number;
  newVersion: number;
  changedFields: string[];
  title: string | null;
}

export interface DocumentoVersionadoPayload {
  documentId: number;
  versionId: number;
  versionNumber: number;
  sourceContext: string;
  changeReason: string | null;
  createdBy: number;
}

export interface DocumentoAprovadoPayload {
  documentId: number;
  processId: number;
  approvedBy: number;
  notes: string | null;
  documentType: DocumentTypeValue;
}

export interface DocumentoRejeitadoPayload {
  documentId: number;
  processId: number;
  rejectedBy: number;
  reason: string;
  documentType: DocumentTypeValue;
}

export interface ComentarioAdicionadoPayload {
  commentId: number;
  documentId: number;
  processId: number;
  authorId: number;
  anchorSection: string | null;
  isReply: boolean;
}

export interface DraftRecuperadoPayload {
  documentId: number;
  userId: number;
  baseVersionId: number | null;
  draftVersion: number;
}

export interface WorkflowAlteradoPayload {
  documentId: number;
  processId: number;
  fromState: DocumentStatusValue;
  toState: DocumentStatusValue;
  reason: string | null;
  actorId: number;
}

// ─── Event type aliases ───────────────────────────────────────────────────────

export type DocumentoCriado     = DomainEvent<DocumentoCriadoPayload>;
export type DocumentoAtualizado = DomainEvent<DocumentoAtualizadoPayload>;
export type DocumentoVersionado = DomainEvent<DocumentoVersionadoPayload>;
export type DocumentoAprovado   = DomainEvent<DocumentoAprovadoPayload>;
export type DocumentoRejeitado  = DomainEvent<DocumentoRejeitadoPayload>;
export type ComentarioAdicionado = DomainEvent<ComentarioAdicionadoPayload>;
export type DraftRecuperado     = DomainEvent<DraftRecuperadoPayload>;
export type WorkflowAlterado    = DomainEvent<WorkflowAlteradoPayload>;

// ─── Event type names (constants) ─────────────────────────────────────────────

export const DOCUMENT_EVENT_TYPES = {
  DOCUMENTO_CRIADO:      "documento.criado",
  DOCUMENTO_ATUALIZADO:  "documento.atualizado",
  DOCUMENTO_VERSIONADO:  "documento.versionado",
  DOCUMENTO_APROVADO:    "documento.aprovado",
  DOCUMENTO_REJEITADO:   "documento.rejeitado",
  COMENTARIO_ADICIONADO: "documento.comentario_adicionado",
  DRAFT_PUBLICADO:       "documento.draft_publicado",
  WORKFLOW_ALTERADO:     "documento.workflow_alterado",
} as const;

export type DocumentEventType = typeof DOCUMENT_EVENT_TYPES[keyof typeof DOCUMENT_EVENT_TYPES];
