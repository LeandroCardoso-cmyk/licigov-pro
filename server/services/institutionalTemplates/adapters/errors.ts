/** Tradução dos erros da persistência (Lane A) para os erros estáveis do workflow (Lane C). Mensagens neutras (sem oráculo). */
import { TemplatePersistenceError } from "../../../db/institutionalTemplates";
import { TemplateWorkflowError } from "../errors";

export function translatePersistenceError(err: unknown): never {
  if (!(err instanceof TemplatePersistenceError)) throw err;
  switch (err.code) {
    case "NOT_FOUND": case "REFERENCE_NOT_FOUND": case "CROSS_TENANT_REFERENCE":
      throw new TemplateWorkflowError("NOT_FOUND", "recurso não encontrado nesta organização");
    case "BINDING_ACTIVE_SCOPE_TAKEN":
      throw new TemplateWorkflowError("BINDING_AMBIGUOUS", "já existe binding ativo para este tipo e escopo; desative-o ou substitua-o");
    case "BINDING_REVISION_NOT_PUBLISHED":
      throw new TemplateWorkflowError("BINDING_NOT_PUBLISHED", "só uma revisão PUBLISHED pode ser vinculada");
    case "BINDING_REVISION_NOT_PINNED":
      throw new TemplateWorkflowError("BINDING_NOT_PINNED", "o binding exige o id exato da revisão");
    case "REVISION_IMMUTABLE":
      throw new TemplateWorkflowError("REVISION_IMMUTABLE", "a revisão é imutável; crie uma nova revisão (DRAFT)");
    case "REVISION_TRANSITION_INVALID":
      throw new TemplateWorkflowError("TRANSITION_INVALID", "transição de estado não permitida");
    case "INVALID_INPUT":
      throw new TemplateWorkflowError("VALIDATION_FAILED", err.message, err.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })));
    case "CONFLICT": case "MANIFEST_ID_CONFLICT": case "ISSUANCE_MANIFEST_CONFLICT": case "MANIFEST_DERIVATION_MISMATCH": case "REFERENCE_PIN_MISMATCH":
      throw new TemplateWorkflowError("CONFLICT", err.message);
    default:
      throw err; // DB_UNAVAILABLE / PERSISTED_RECORD_CORRUPT: falha fechada, sem tradução enganosa
  }
}

export async function translating<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) { return translatePersistenceError(err); }
}
