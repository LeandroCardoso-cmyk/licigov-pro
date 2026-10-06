/** Erros estáveis do workflow de Modelos Institucionais (token estável na mensagem; nenhum dado de outro tenant). */
export type TemplateWorkflowErrorCode =
  | "HUMAN_ACTION_REQUIRED"
  | "MODULE_DISABLED"
  | "PORTS_NOT_CONFIGURED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "CONFIRMATION_REQUIRED"
  | "REVISION_IMMUTABLE"
  | "TRANSITION_INVALID"
  | "STALE_STATE"
  | "BINDING_AMBIGUOUS"
  | "BINDING_NOT_PINNED"
  | "BINDING_NOT_PUBLISHED"
  | "REVISION_PINNED_BY_BINDING"
  | "IMPORT_REJECTED"
  | "DECISION_REJECTED";

export interface TemplateWorkflowIssue { readonly code: string; readonly path: string; readonly message: string }

export class TemplateWorkflowError extends Error {
  constructor(
    readonly code: TemplateWorkflowErrorCode,
    message: string,
    readonly issues: readonly TemplateWorkflowIssue[] = [],
  ) {
    super(`${code}: ${message}`);
    this.name = "TemplateWorkflowError";
  }
}
