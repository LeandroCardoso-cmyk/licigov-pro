/**
 * Institutional Templates — erros da camada de persistência.
 *
 * Mensagens NUNCA distinguem "não existe" de "existe em outro tenant": toda consulta é escopada por tenant e uma
 * referência de outro tenant é tratada exatamente como inexistente (não há oráculo de existência entre organizações).
 */
import type { TemplateIssue } from "../../domain/institutionalTemplates";

export type TemplatePersistenceErrorCode =
  | "DB_UNAVAILABLE"
  | "INVALID_INPUT"
  | "CROSS_TENANT_REFERENCE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_PIN_MISMATCH"
  | "REVISION_IMMUTABLE"
  | "REVISION_TRANSITION_INVALID"
  | "BINDING_REVISION_NOT_PINNED"
  | "BINDING_REVISION_NOT_PUBLISHED"
  | "BINDING_ACTIVE_SCOPE_TAKEN"
  | "MANIFEST_ID_CONFLICT"
  | "MANIFEST_DERIVATION_MISMATCH"
  | "ISSUANCE_MANIFEST_CONFLICT"
  | "PERSISTED_RECORD_CORRUPT";

export class TemplatePersistenceError extends Error {
  readonly code: TemplatePersistenceErrorCode;
  readonly issues: readonly TemplateIssue[];
  constructor(code: TemplatePersistenceErrorCode, message: string, issues: readonly TemplateIssue[] = []) {
    super(`${code}: ${message}`);
    this.name = "TemplatePersistenceError";
    this.code = code;
    this.issues = issues;
  }
}

export function isTemplatePersistenceError(err: unknown, code?: TemplatePersistenceErrorCode): err is TemplatePersistenceError {
  return err instanceof TemplatePersistenceError && (code === undefined || err.code === code);
}
