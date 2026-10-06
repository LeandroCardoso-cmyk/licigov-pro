/**
 * Contrato do composer puro (T1_DESIGN_PACKAGE). SÓ a assinatura: a implementação é da fase T7.
 *
 * Regras do contrato: valores e narrativas de IA chegam JÁ resolvidos (obtidos antes da transação); o composer
 * não faz I/O, não lê relógio, não gera id e não chama IA. Mesma entrada ⇒ mesma saída e mesmo hash.
 * Erro com flag ON ⇒ falha fechada (sem fallback silencioso para o caminho legado).
 */
import type { GenerationManifest } from "./manifest";
import type { TemplateRevision } from "./revision";
import type { VariableCatalog } from "./variableCatalog";

export interface ComposeInput {
  readonly revision: TemplateRevision;
  readonly catalog: VariableCatalog;
  readonly values: Readonly<Record<string, unknown>>;
  readonly aiNarratives: Readonly<Record<string, string>>;
}

/** Conteúdo composto persistível (`generated_documents.content`). */
export interface ComposedContent {
  readonly text: string;
}

export type ComposeErrorCode = "UNKNOWN_VARIABLE" | "MISSING_REQUIRED" | "AST_INVALID" | "CONDITION_INVALID";

export type ComposeOutcome =
  | { readonly content: ComposedContent; readonly manifestDraft: Omit<GenerationManifest, "id" | "createdAt"> }
  | { readonly error: ComposeErrorCode };

export type ComposeFn = (input: ComposeInput) => ComposeOutcome;
