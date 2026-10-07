/**
 * Despacho por VERSÃO do contrato do modelo (`tpl-ast/1` · `tpl-ast/2` e catálogos `tpl-catalog/1` · `tpl-catalog/2`).
 *
 * Regras de compatibilidade (replay):
 *  - `tpl-ast/1` é validado EXATAMENTE pelo validador v1 (`validateTemplateAst` + `validateVariableCatalog`), sem
 *    reinterpretação: hashes, composições e manifests antigos continuam reproduzíveis byte a byte;
 *  - AST e catálogo andam juntos: v1 com v1, v2 com v2. Mistura ⇒ `CATALOG_FORMAT_MISMATCH` (nunca coerção silenciosa);
 *  - schema desconhecido ⇒ `AST_VERSION_UNSUPPORTED` (fail-closed).
 * O hash semântico (`tpl-hash/1`) não muda: o `schema` do AST faz parte do conteúdo hasheado, então um AST v2 nunca
 * colide com um AST v1.
 */
import { validateTemplateAst, referencedVariables, type TemplateAST } from "./ast";
import { templateRequirements } from "./composerRequirements";
import { AST_SCHEMA_2, referencedVariables2, templateRequirements2, validateTemplateAst2, type DocRefKind2, type TemplateAST2 } from "./ast2";
import { fail, issue, type TemplateResult } from "./types";
import { validateVariableCatalog, findVariable, type VariableCatalog, type VariableDef } from "./variableCatalog";
import { CATALOG_FORMAT_2, findVariable2, validateVariableCatalog2, type VariableCatalog2, type VariableDef2 } from "./variableCatalog2";

export const AST_SCHEMA_1 = "tpl-ast/1" as const;

export type AnyTemplateAST = TemplateAST | TemplateAST2;
export type AnyVariableCatalog = VariableCatalog | VariableCatalog2;
export type AnyVariableDef = VariableDef | VariableDef2;

export function isAstV2(ast: unknown): ast is TemplateAST2 {
  return typeof ast === "object" && ast !== null && (ast as { schema?: unknown }).schema === AST_SCHEMA_2;
}

export function isCatalogV2(catalog: unknown): catalog is VariableCatalog2 {
  return typeof catalog === "object" && catalog !== null && (catalog as { format?: unknown }).format === CATALOG_FORMAT_2;
}

/** Valida o catálogo pelo contrato da sua versão. */
export function validateAnyCatalog(catalog: AnyVariableCatalog): TemplateResult<AnyVariableCatalog> {
  return isCatalogV2(catalog) ? validateVariableCatalog2(catalog) : validateVariableCatalog(catalog);
}

/** Valida o AST pelo contrato da sua versão, exigindo o catálogo da mesma versão. */
export function validateAnyTemplateAst(ast: unknown, catalog: AnyVariableCatalog): TemplateResult<AnyTemplateAST> {
  const schema = typeof ast === "object" && ast !== null ? (ast as { schema?: unknown }).schema : undefined;
  if (schema === AST_SCHEMA_2) {
    if (!isCatalogV2(catalog)) return fail([issue("CATALOG_FORMAT_MISMATCH", "catalog", `AST ${AST_SCHEMA_2} exige catálogo ${CATALOG_FORMAT_2}`)]);
    return validateTemplateAst2(ast, catalog);
  }
  // Família `tpl-ast/N` com N desconhecido: versão não suportada (fail-closed, mensagem própria).
  if (typeof schema === "string" && schema !== AST_SCHEMA_1 && /^tpl-ast\/\d+$/.test(schema)) {
    return fail([issue("AST_VERSION_UNSUPPORTED", "schema", `versão de AST não suportada: ${schema}`)]);
  }
  // Caminho v1 (inclusive entradas malformadas): o validador v1 responde, com comportamento e mensagens inalterados.
  if (isCatalogV2(catalog)) return fail([issue("CATALOG_FORMAT_MISMATCH", "catalog", `AST ${AST_SCHEMA_1} exige catálogo v1; o informado é ${CATALOG_FORMAT_2}`)]);
  return validateTemplateAst(ast, catalog);
}

/** Variáveis referenciadas pelo AST (qualquer versão), ordenadas e sem repetição. */
export function referencedVariablesAny(ast: AnyTemplateAST): string[] {
  return isAstV2(ast) ? referencedVariables2(ast) : referencedVariables(ast);
}

/** Pins oficiais (tipos) e slots de IA que o AST exige, sem renderizar (qualquer versão). */
export function templateRequirementsAny(ast: AnyTemplateAST): { docRefKinds: DocRefKind2[]; aiSlots: string[] } {
  if (isAstV2(ast)) {
    const r = templateRequirements2(ast.root);
    return { docRefKinds: [...r.docRefKinds], aiSlots: [...r.aiSlots] };
  }
  return templateRequirements(ast.root);
}

/** Busca exata por nome no catálogo (qualquer versão). */
export function findAnyVariable(catalog: AnyVariableCatalog, name: string): AnyVariableDef | undefined {
  return isCatalogV2(catalog) ? findVariable2(catalog, name) : findVariable(catalog, name);
}
