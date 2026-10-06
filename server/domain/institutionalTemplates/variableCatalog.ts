/**
 * Catálogo de variáveis — CONTRATO DE CÓDIGO VERSIONADO (INV-TPL-24/25; T1_DESIGN_PACKAGE).
 *
 * A fonte (`source` + `path`) de cada chave pertence ao catálogo do produto, nunca ao template: o AST só
 * referencia `name`. Variável desconhecida ⇒ falha fechada (submit bloqueado). As entradas reais do catálogo
 * de produção são definidas nas fases T4/T5; aqui ficam o contrato e a validação.
 */
import { issue, type TemplateIssue, type TemplateResult, ok, fail } from "./types";

export type VariableType = "string" | "number" | "money" | "date" | "enum" | "list";
export type VariableSource = "PROCESS" | "DFD" | "ETP" | "TR" | "ITEMS" | "PARAMS" | "IDENTITY";

export const VARIABLE_TYPES: readonly VariableType[] = ["string", "number", "money", "date", "enum", "list"];
export const VARIABLE_SOURCES: readonly VariableSource[] = ["PROCESS", "DFD", "ETP", "TR", "ITEMS", "PARAMS", "IDENTITY"];

export interface VariableDef {
  readonly name: string;
  readonly type: VariableType;
  readonly source: VariableSource;
  readonly path: string;
  readonly required: boolean;
}

export interface VariableCatalog {
  readonly version: string;
  readonly vars: readonly VariableDef[];
}

/** Nome de variável: identificador estável, sem espaços nem caracteres de expressão. */
export const VARIABLE_NAME_RE = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;

export function validateVariableCatalog(catalog: VariableCatalog): TemplateResult<VariableCatalog> {
  const issues: TemplateIssue[] = [];
  if (typeof catalog.version !== "string" || catalog.version.trim() === "") {
    issues.push(issue("CATALOG_INVALID", "version", "versão do catálogo obrigatória"));
  }
  const seen = new Set<string>();
  catalog.vars.forEach((v, i) => {
    const p = `vars[${i}]`;
    if (!VARIABLE_NAME_RE.test(v.name)) issues.push(issue("CATALOG_INVALID", `${p}.name`, `nome inválido: ${String(v.name)}`));
    if (seen.has(v.name)) issues.push(issue("CATALOG_INVALID", `${p}.name`, `variável duplicada: ${v.name}`));
    seen.add(v.name);
    if (!VARIABLE_TYPES.includes(v.type)) issues.push(issue("CATALOG_INVALID", `${p}.type`, `tipo inválido: ${String(v.type)}`));
    if (!VARIABLE_SOURCES.includes(v.source)) issues.push(issue("CATALOG_INVALID", `${p}.source`, `fonte inválida: ${String(v.source)}`));
    if (typeof v.path !== "string" || v.path.trim() === "") issues.push(issue("CATALOG_INVALID", `${p}.path`, "path obrigatório"));
    if (typeof v.required !== "boolean") issues.push(issue("CATALOG_INVALID", `${p}.required`, "required deve ser booleano"));
  });
  return issues.length ? fail(issues) : ok(catalog);
}

/** Busca exata por nome. `undefined` = variável desconhecida (quem chama falha fechado). */
export function findVariable(catalog: VariableCatalog, name: string): VariableDef | undefined {
  return catalog.vars.find((v) => v.name === name);
}
