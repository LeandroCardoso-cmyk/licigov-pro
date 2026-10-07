/**
 * Catálogo de variáveis — versão 2 (`tpl-catalog/2`), CONTRATO DE CÓDIGO versionado (INV-TPL-24/25).
 *
 * O catálogo v1 (`variableCatalog.ts`) continua intacto e resolvível para replay: este módulo é paralelo, não o substitui.
 * Evolução (nada degrada para `string`):
 *  - tipos fortes: string · text · integer · number · boolean · money · percent · date · time · datetime · duration ·
 *    enum · list · table · url · cnpj · document_ref;
 *  - fontes EXPLÍCITAS conforme a autoridade real (IDENTITY, PROCESS, ITEMS, TR, DFD, ETP, BUDGET, CERTAME_CONFIG, POLICY,
 *    NORMATIVE, RESULT, LIFECYCLE, PARAMS). As fontes v1 mantêm o mesmo significado; `PARAMS` NÃO é um saco genérico —
 *    é só o que realmente são parâmetros do documento;
 *  - `renderable = false` marca CONTROLE: a variável participa de condição, validação (`requiredWhen`) e decisão de
 *    composição, mas NUNCA aparece como texto (o AST v2 recusa `var` de controle);
 *  - `table` carrega o esquema das colunas (fonte governada de tabelas dinâmicas); `enum` carrega o conjunto fechado.
 * A fonte (`source` + `path`) de cada variável pertence ao catálogo, nunca ao template. A IA nunca é fonte de variável.
 *
 * Convenções de valor canônico (as fontes entregam exatamente isto; o composer valida e normaliza):
 *  money = centavos inteiros · percent = pontos percentuais (5.5 ⇒ 5,5%) · date = AAAA-MM-DD real · time = HH:MM ·
 *  datetime = AAAA-MM-DDTHH:MM (horário local, sem fuso) · duration = { amount: inteiro ≥ 0, unit } · cnpj = 14 dígitos
 *  (formatado é aceito e normalizado; dígito verificador válido) · document_ref = pin exato de documento oficial.
 */
import { VARIABLE_NAME_RE } from "./variableCatalog";
import { validateCondition2, conditionVariables, type Cond2 } from "./conditionalDsl2";
import type { DocRefKind2 } from "./ast2";
import { fail, issue, ok, type TemplateIssue, type TemplateResult } from "./types";

export const CATALOG_FORMAT_2 = "tpl-catalog/2" as const;

export type VariableType2 =
  | "string" | "text" | "integer" | "number" | "boolean" | "money" | "percent" | "date" | "time" | "datetime"
  | "duration" | "enum" | "list" | "table" | "url" | "cnpj" | "document_ref";
export const VARIABLE_TYPES_2: readonly VariableType2[] = [
  "string", "text", "integer", "number", "boolean", "money", "percent", "date", "time", "datetime",
  "duration", "enum", "list", "table", "url", "cnpj", "document_ref",
];

export type VariableSource2 =
  | "IDENTITY" | "PROCESS" | "ITEMS" | "TR" | "DFD" | "ETP" | "PARAMS"
  | "BUDGET" | "CERTAME_CONFIG" | "POLICY" | "NORMATIVE" | "RESULT" | "LIFECYCLE";
export const VARIABLE_SOURCES_2: readonly VariableSource2[] = [
  "IDENTITY", "PROCESS", "ITEMS", "TR", "DFD", "ETP", "PARAMS", "BUDGET", "CERTAME_CONFIG", "POLICY", "NORMATIVE", "RESULT", "LIFECYCLE",
];

/** Tipos escalares aceitos como coluna de tabela e como item de lista. */
export type ScalarType2 = "string" | "text" | "integer" | "number" | "boolean" | "money" | "percent" | "date" | "time" | "datetime" | "url" | "cnpj";
export const SCALAR_TYPES_2: readonly ScalarType2[] = ["string", "text", "integer", "number", "boolean", "money", "percent", "date", "time", "datetime", "url", "cnpj"];

export const DURATION_UNITS = ["hour", "day", "businessDay", "month", "year"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];
export interface DurationValue { readonly amount: number; readonly unit: DurationUnit }

export interface TableColumnDef {
  readonly key: string;
  readonly type: ScalarType2;
  /** Descrição humana da coluna (documentação; o cabeçalho renderizado vem do AST). */
  readonly label: string;
  /** Padrão `true`: célula ausente na linha ⇒ recusa. */
  readonly required?: boolean;
}

export interface VariableDef2 {
  readonly name: string;
  readonly type: VariableType2;
  readonly source: VariableSource2;
  readonly path: string;
  readonly required: boolean;
  /** `false` = CONTROLE: usável em condição/validação/decisão; NUNCA renderizável como texto. */
  readonly renderable: boolean;
  readonly enumValues?: readonly string[];
  readonly itemType?: ScalarType2;
  readonly columns?: readonly TableColumnDef[];
  readonly documentKind?: DocRefKind2;
  /** Validação condicional: obrigatória quando esta condição (sobre outras variáveis) é verdadeira. */
  readonly requiredWhen?: Cond2;
  /** Documentação (não participa de hash de revisão). */
  readonly description?: string;
}

export interface VariableCatalog2 {
  readonly format: typeof CATALOG_FORMAT_2;
  /** Versão do catálogo (chave do registro de código; imutável depois de usada por uma revisão). */
  readonly version: string;
  readonly vars: readonly VariableDef2[];
}

export const TABLE_COLUMN_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CATALOG_PATH_SEGMENT_RE = /^[A-Za-z0-9_]{1,64}$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const NON_RENDERABLE_FORBIDDEN: readonly VariableType2[] = ["table", "list", "document_ref"];

function pathIssues(path: string): boolean {
  if (typeof path !== "string" || path.trim() === "") return true;
  return path.split(".").some((s) => !CATALOG_PATH_SEGMENT_RE.test(s) || FORBIDDEN_SEGMENTS.has(s));
}

export function validateVariableCatalog2(catalog: VariableCatalog2): TemplateResult<VariableCatalog2> {
  const issues: TemplateIssue[] = [];
  if (catalog.format !== CATALOG_FORMAT_2) issues.push(issue("CATALOG_FORMAT_MISMATCH", "format", `format deve ser ${CATALOG_FORMAT_2}`));
  if (typeof catalog.version !== "string" || catalog.version.trim() === "") issues.push(issue("CATALOG_INVALID", "version", "versão do catálogo obrigatória"));
  const seen = new Set<string>();
  catalog.vars.forEach((v, i) => {
    const p = `vars[${i}]`;
    if (!VARIABLE_NAME_RE.test(v.name)) issues.push(issue("CATALOG_INVALID", `${p}.name`, `nome inválido: ${String(v.name)}`));
    if (seen.has(v.name)) issues.push(issue("CATALOG_INVALID", `${p}.name`, `variável duplicada: ${v.name}`));
    seen.add(v.name);
    if (!VARIABLE_TYPES_2.includes(v.type)) issues.push(issue("CATALOG_INVALID", `${p}.type`, `tipo inválido: ${String(v.type)}`));
    if (!VARIABLE_SOURCES_2.includes(v.source)) issues.push(issue("CATALOG_INVALID", `${p}.source`, `fonte inválida: ${String(v.source)}`));
    if (pathIssues(v.path)) issues.push(issue("CATALOG_INVALID", `${p}.path`, "path inválido (segmentos [A-Za-z0-9_] separados por ponto)"));
    if (typeof v.required !== "boolean") issues.push(issue("CATALOG_INVALID", `${p}.required`, "required deve ser booleano"));
    if (typeof v.renderable !== "boolean") issues.push(issue("CATALOG_INVALID", `${p}.renderable`, "renderable deve ser booleano"));
    if (v.renderable === false && NON_RENDERABLE_FORBIDDEN.includes(v.type)) {
      issues.push(issue("CATALOG_INVALID", `${p}.renderable`, `controle (renderable=false) não pode ser do tipo ${v.type}`));
    }
    // Esquema por tipo: cada metadado só existe no tipo que o usa.
    if (v.type === "enum") {
      const ev = v.enumValues;
      if (!Array.isArray(ev) || ev.length === 0 || ev.some((x) => typeof x !== "string" || x === "") || new Set(ev).size !== ev.length) {
        issues.push(issue("CATALOG_INVALID", `${p}.enumValues`, "enum exige conjunto fechado, não vazio, de textos únicos"));
      }
    } else if (v.enumValues !== undefined) issues.push(issue("CATALOG_INVALID", `${p}.enumValues`, "enumValues só vale para enum"));
    if (v.type === "list") {
      if (!v.itemType || !SCALAR_TYPES_2.includes(v.itemType)) issues.push(issue("CATALOG_INVALID", `${p}.itemType`, "lista exige itemType escalar"));
    } else if (v.itemType !== undefined) issues.push(issue("CATALOG_INVALID", `${p}.itemType`, "itemType só vale para lista"));
    if (v.type === "table") {
      const cols = v.columns;
      if (!Array.isArray(cols) || cols.length === 0) issues.push(issue("CATALOG_INVALID", `${p}.columns`, "tabela exige ao menos uma coluna"));
      else {
        const keys = new Set<string>();
        cols.forEach((c, j) => {
          const cp = `${p}.columns[${j}]`;
          if (!TABLE_COLUMN_KEY_RE.test(c.key)) issues.push(issue("CATALOG_INVALID", `${cp}.key`, `chave de coluna inválida: ${String(c.key)}`));
          if (keys.has(c.key)) issues.push(issue("CATALOG_INVALID", `${cp}.key`, `coluna duplicada: ${c.key}`));
          keys.add(c.key);
          if (!SCALAR_TYPES_2.includes(c.type)) issues.push(issue("CATALOG_INVALID", `${cp}.type`, `tipo de coluna inválido: ${String(c.type)}`));
          if (typeof c.label !== "string" || c.label.trim() === "") issues.push(issue("CATALOG_INVALID", `${cp}.label`, "label da coluna obrigatório"));
        });
      }
    } else if (v.columns !== undefined) issues.push(issue("CATALOG_INVALID", `${p}.columns`, "columns só vale para tabela"));
    if (v.type === "document_ref") {
      if (!v.documentKind) issues.push(issue("CATALOG_INVALID", `${p}.documentKind`, "document_ref exige documentKind"));
    } else if (v.documentKind !== undefined) issues.push(issue("CATALOG_INVALID", `${p}.documentKind`, "documentKind só vale para document_ref"));
  });
  if (issues.length) return fail(issues);

  // `requiredWhen`: validada contra o catálogo, só em variável opcional, sem auto-referência nem ciclo.
  const byName = new Map(catalog.vars.map((v) => [v.name, v]));
  const graph = new Map<string, string[]>();
  catalog.vars.forEach((v, i) => {
    if (v.requiredWhen === undefined) return;
    const p = `vars[${i}].requiredWhen`;
    if (v.required) issues.push(issue("CATALOG_INVALID", p, "requiredWhen é redundante em variável já obrigatória"));
    const condIssues = validateCondition2(v.requiredWhen, catalog, p);
    issues.push(...condIssues);
    if (!condIssues.length) {
      const deps = conditionVariables(v.requiredWhen);
      if (deps.includes(v.name)) issues.push(issue("CATALOG_INVALID", p, "requiredWhen não pode depender da própria variável"));
      graph.set(v.name, deps.filter((d) => byName.get(d)?.requiredWhen !== undefined));
    }
  });
  // Ciclo entre requiredWhen (A depende de B, B depende de A): resolução indeterminada.
  const state = new Map<string, 1 | 2>();
  const visit = (n: string, stack: string[]): boolean => {
    if (state.get(n) === 2) return false;
    if (state.get(n) === 1) { issues.push(issue("CATALOG_INVALID", "requiredWhen", `ciclo em requiredWhen: ${[...stack, n].join(" → ")}`)); return true; }
    state.set(n, 1);
    for (const d of graph.get(n) ?? []) if (visit(d, [...stack, n])) { state.set(n, 2); return true; }
    state.set(n, 2);
    return false;
  };
  for (const n of graph.keys()) visit(n, []);
  return issues.length ? fail(issues) : ok(catalog);
}

export function findVariable2(catalog: VariableCatalog2, name: string): VariableDef2 | undefined {
  return catalog.vars.find((v) => v.name === name);
}
