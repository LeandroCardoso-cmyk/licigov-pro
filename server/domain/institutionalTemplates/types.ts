/**
 * Institutional Document Templates — T1 (domínio puro): tipos-base e resultado de validação.
 *
 * Fonte: T1_DESIGN_PACKAGE (fast-track) + invariantes PRE-G0 congeladas (INV-TPL-01..37). Sem I/O, sem relógio,
 * sem IA. Toda entidade carrega `organizationId` explícito (V1 organization-only; não existe PLATFORM_GLOBAL).
 */

/** `organizations.id` (INT). Obrigatório em toda identidade do contexto institucional. */
export type OrgId = number;
/** SHA-256 em hex minúsculo (64 caracteres). */
export type Sha256 = string;
/** Versão da regra de hash semântico. Mudança de regra ⇒ nova versão; hashes antigos nunca são reinterpretados. */
export type HashVersion = "tpl-hash/1";
export const TEMPLATE_HASH_VERSION: HashVersion = "tpl-hash/1";

export type TemplateDocumentKind = "dfd" | "etp" | "tr" | "edital" | "parecer" | "contrato" | "aditivo";
export const TEMPLATE_DOCUMENT_KINDS: readonly TemplateDocumentKind[] = [
  "dfd", "etp", "tr", "edital", "parecer", "contrato", "aditivo",
];

export type TemplateIssueCode =
  | "ORGANIZATION_REQUIRED"
  | "CROSS_TENANT_REFERENCE"
  | "AST_INVALID"
  | "AST_UNKNOWN_NODE"
  | "AST_DEPTH_EXCEEDED"
  | "UNKNOWN_VARIABLE"
  | "CONDITION_INVALID"
  | "CONDITION_DEPTH_EXCEEDED"
  | "CATALOG_INVALID"
  | "CATALOG_VERSION_MISMATCH"
  | "REVISION_INVALID"
  | "REVISION_TRANSITION_INVALID"
  | "REVISION_IMMUTABLE"
  | "REVISION_IN_USE"
  | "IMPORT_MUST_START_AS_DRAFT"
  | "DECISION_REQUIRED"
  | "BINDING_INVALID"
  | "BINDING_REVISION_NOT_PINNED"
  | "BINDING_REVISION_NOT_PUBLISHED"
  | "MANIFEST_INVALID"
  | "MANIFEST_HASH_MISMATCH"
  | "REFERENCE_NOT_PINNED"
  | "HASH_INVALID"
  | "SOURCE_PAYLOAD_INVALID"
  // tpl-ast/2 · tpl-catalog/2 (aditivos: nenhum código anterior muda de significado)
  | "AST_VERSION_UNSUPPORTED"
  | "CATALOG_FORMAT_MISMATCH"
  | "CONTROL_ONLY_VARIABLE_RENDERED"
  | "ANCHOR_DUPLICATE"
  | "XREF_TARGET_UNKNOWN"
  | "XREF_TARGET_NOT_NUMBERED"
  | "TABLE_BINDING_INVALID"
  | "CHOICE_INVALID"
  | "ANNEX_INVALID"
  | "DOCREF_INVALID";

export interface TemplateIssue {
  readonly code: TemplateIssueCode;
  /** Caminho estrutural do problema (ex.: `root[2].then[0].inline[1]`). */
  readonly path: string;
  readonly message: string;
}

export type TemplateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly TemplateIssue[] };

export function ok<T>(value: T): TemplateResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(issues: readonly TemplateIssue[]): TemplateResult<T> {
  return { ok: false, issues };
}

export function issue(code: TemplateIssueCode, path: string, message: string): TemplateIssue {
  return { code, path, message };
}

const SHA256_RE = /^[0-9a-f]{64}$/;
export function isSha256(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256_RE.test(value);
}

export function isOrgId(value: unknown): value is OrgId {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
