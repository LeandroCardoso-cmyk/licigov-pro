/**
 * TemplateAST — representação CANÔNICA do modelo (INV-TPL-14 STRUCTURED_AST; INV-TPL-28 whitelist).
 *
 * Markdown/DOCX são só import/export/revisão; a autoridade é este AST. Conjunto FECHADO de nós e de propriedades
 * (T1_DESIGN_PACKAGE): nó, propriedade ou operador desconhecido ⇒ AST_INVALID. Nada aqui é executado: texto é
 * literal, `var` só referencia o catálogo, `aiSlot` é o ÚNICO ponto de IA e `conditional` usa a DSL fechada.
 */
import { validateCondition, type Cond } from "./conditionalDsl";
import { findVariable, type VariableCatalog } from "./variableCatalog";
import { issue, ok, fail, type TemplateIssue, type TemplateResult } from "./types";

export type Inline =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "var"; readonly name: string }
  | { readonly t: "strong" | "em"; readonly v: readonly Inline[] };
export type TextExpr = readonly Inline[];

export type DocRefKind = "TR" | "ETP" | "DFD" | "ANNEX";

export type TemplateNode =
  | { readonly t: "heading"; readonly level: 1 | 2 | 3 | 4; readonly text: TextExpr }
  | { readonly t: "paragraph"; readonly inline: readonly Inline[] }
  | { readonly t: "list"; readonly ordered: boolean; readonly items: readonly (readonly TemplateNode[])[] }
  | { readonly t: "table"; readonly header: readonly TextExpr[]; readonly rows: readonly (readonly TextExpr[])[] }
  | { readonly t: "section"; readonly key: string; readonly legalRef?: string; readonly children: readonly TemplateNode[] }
  | { readonly t: "conditional"; readonly when: Cond; readonly then: readonly TemplateNode[]; readonly else?: readonly TemplateNode[] }
  | { readonly t: "docRef"; readonly kind: DocRefKind; readonly mode: "EXACT_PINNED" }
  | { readonly t: "annex"; readonly id: string; readonly title: TextExpr; readonly children: readonly TemplateNode[] }
  | { readonly t: "aiSlot"; readonly slotKey: string; readonly maxTokens: number; readonly instructionsKey: string };

export interface TemplateAST {
  readonly schema: "tpl-ast/1";
  readonly root: readonly TemplateNode[];
}

/**
 * Limite estrutural de aninhamento (proteção contra abuso recursivo) — decisão do owner R-6:
 * MAX_AST_DEPTH = IMPLEMENTATION_SAFETY_LIMIT · NOT_LEGAL_RULE · NOT_INSTITUTIONAL_DECISION.
 * Pertence ao contrato técnico versionado de `tpl-ast/1` (mudança ⇒ nova versão do schema), nunca a uma regra
 * jurídica ou institucional. A profundidade da condição (≤ 4) é a regra da DSL do T1.
 */
export const MAX_AST_DEPTH = 32;

const NODE_KEYS: Record<TemplateNode["t"], { readonly required: readonly string[]; readonly optional: readonly string[] }> = {
  heading: { required: ["t", "level", "text"], optional: [] },
  paragraph: { required: ["t", "inline"], optional: [] },
  list: { required: ["t", "ordered", "items"], optional: [] },
  table: { required: ["t", "header", "rows"], optional: [] },
  section: { required: ["t", "key", "children"], optional: ["legalRef"] },
  conditional: { required: ["t", "when", "then"], optional: ["else"] },
  docRef: { required: ["t", "kind", "mode"], optional: [] },
  annex: { required: ["t", "id", "title", "children"], optional: [] },
  aiSlot: { required: ["t", "slotKey", "maxTokens", "instructionsKey"], optional: [] },
};
const INLINE_KEYS: Record<Inline["t"], readonly string[]> = {
  text: ["t", "v"], var: ["t", "name"], strong: ["t", "v"], em: ["t", "v"],
};
const DOC_REF_KINDS: readonly DocRefKind[] = ["TR", "ETP", "DFD", "ANNEX"];
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function closedKeyIssues(obj: Record<string, unknown>, allowed: readonly string[], required: readonly string[], path: string): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) out.push(issue("AST_INVALID", path, `propriedade não permitida: ${k}`));
  }
  for (const k of required) {
    if (!(k in obj)) out.push(issue("AST_INVALID", path, `propriedade obrigatória ausente: ${k}`));
  }
  return out;
}

interface WalkState {
  readonly catalog: VariableCatalog;
  readonly issues: TemplateIssue[];
  readonly slotKeys: Set<string>;
  readonly annexIds: Set<string>;
}

function walkInline(value: unknown, path: string, depth: number, s: WalkState): void {
  if (depth > MAX_AST_DEPTH) { s.issues.push(issue("AST_DEPTH_EXCEEDED", path, `profundidade máxima ${MAX_AST_DEPTH}`)); return; }
  if (!isPlainObject(value) || typeof value.t !== "string" || !Object.prototype.hasOwnProperty.call(INLINE_KEYS, value.t)) {
    s.issues.push(issue("AST_UNKNOWN_NODE", path, `inline fora da whitelist: ${isPlainObject(value) ? String(value.t) : typeof value}`));
    return;
  }
  const t = value.t as Inline["t"];
  const keyIssues = closedKeyIssues(value, INLINE_KEYS[t], INLINE_KEYS[t], path);
  if (keyIssues.length) { s.issues.push(...keyIssues); return; }
  if (t === "text") {
    if (typeof value.v !== "string") s.issues.push(issue("AST_INVALID", `${path}.v`, "texto deve ser string"));
  } else if (t === "var") {
    if (typeof value.name !== "string" || !findVariable(s.catalog, value.name)) {
      s.issues.push(issue("UNKNOWN_VARIABLE", `${path}.name`, `variável fora do catálogo ${s.catalog.version}: ${String(value.name)}`));
    }
  } else {
    walkInlineList(value.v, `${path}.v`, depth + 1, s);
  }
}

function walkInlineList(value: unknown, path: string, depth: number, s: WalkState): void {
  if (!Array.isArray(value)) { s.issues.push(issue("AST_INVALID", path, "esperada lista de inlines")); return; }
  value.forEach((v, i) => walkInline(v, `${path}[${i}]`, depth, s));
}

function walkNodes(value: unknown, path: string, depth: number, s: WalkState): void {
  if (!Array.isArray(value)) { s.issues.push(issue("AST_INVALID", path, "esperada lista de nós")); return; }
  value.forEach((n, i) => walkNode(n, `${path}[${i}]`, depth, s));
}

function walkNode(value: unknown, path: string, depth: number, s: WalkState): void {
  if (depth > MAX_AST_DEPTH) { s.issues.push(issue("AST_DEPTH_EXCEEDED", path, `profundidade máxima ${MAX_AST_DEPTH}`)); return; }
  if (!isPlainObject(value) || typeof value.t !== "string" || !Object.prototype.hasOwnProperty.call(NODE_KEYS, value.t)) {
    s.issues.push(issue("AST_UNKNOWN_NODE", path, `nó fora da whitelist: ${isPlainObject(value) ? String(value.t) : typeof value}`));
    return;
  }
  const t = value.t as TemplateNode["t"];
  const spec = NODE_KEYS[t];
  const keyIssues = closedKeyIssues(value, [...spec.required, ...spec.optional], spec.required, path);
  if (keyIssues.length) { s.issues.push(...keyIssues); return; }

  switch (t) {
    case "heading":
      if (![1, 2, 3, 4].includes(value.level as number)) s.issues.push(issue("AST_INVALID", `${path}.level`, "nível de título deve ser 1–4"));
      walkInlineList(value.text, `${path}.text`, depth + 1, s);
      return;
    case "paragraph":
      walkInlineList(value.inline, `${path}.inline`, depth + 1, s);
      return;
    case "list":
      if (typeof value.ordered !== "boolean") s.issues.push(issue("AST_INVALID", `${path}.ordered`, "ordered deve ser booleano"));
      if (!Array.isArray(value.items)) { s.issues.push(issue("AST_INVALID", `${path}.items`, "items deve ser lista")); return; }
      value.items.forEach((item, i) => walkNodes(item, `${path}.items[${i}]`, depth + 1, s));
      return;
    case "table":
      if (!Array.isArray(value.header)) s.issues.push(issue("AST_INVALID", `${path}.header`, "header deve ser lista"));
      else value.header.forEach((h, i) => walkInlineList(h, `${path}.header[${i}]`, depth + 1, s));
      if (!Array.isArray(value.rows)) { s.issues.push(issue("AST_INVALID", `${path}.rows`, "rows deve ser lista")); return; }
      value.rows.forEach((row, r) => {
        if (!Array.isArray(row)) { s.issues.push(issue("AST_INVALID", `${path}.rows[${r}]`, "linha deve ser lista")); return; }
        row.forEach((cell, c) => walkInlineList(cell, `${path}.rows[${r}][${c}]`, depth + 1, s));
      });
      return;
    case "section":
      if (typeof value.key !== "string" || !KEY_RE.test(value.key)) s.issues.push(issue("AST_INVALID", `${path}.key`, "chave de seção inválida"));
      if (value.legalRef !== undefined && typeof value.legalRef !== "string") s.issues.push(issue("AST_INVALID", `${path}.legalRef`, "legalRef deve ser string"));
      walkNodes(value.children, `${path}.children`, depth + 1, s);
      return;
    case "conditional":
      s.issues.push(...validateCondition(value.when, s.catalog, `${path}.when`));
      walkNodes(value.then, `${path}.then`, depth + 1, s);
      if (value.else !== undefined) walkNodes(value.else, `${path}.else`, depth + 1, s);
      return;
    case "docRef":
      if (!DOC_REF_KINDS.includes(value.kind as DocRefKind)) s.issues.push(issue("AST_INVALID", `${path}.kind`, "tipo de referência fora da whitelist"));
      if (value.mode !== "EXACT_PINNED") s.issues.push(issue("AST_INVALID", `${path}.mode`, "referência oficial só por pin exato (EXACT_PINNED)"));
      return;
    case "annex":
      if (typeof value.id !== "string" || !KEY_RE.test(value.id)) s.issues.push(issue("AST_INVALID", `${path}.id`, "id de anexo inválido"));
      else if (s.annexIds.has(value.id)) s.issues.push(issue("AST_INVALID", `${path}.id`, `anexo duplicado: ${value.id}`));
      else s.annexIds.add(value.id);
      walkInlineList(value.title, `${path}.title`, depth + 1, s);
      walkNodes(value.children, `${path}.children`, depth + 1, s);
      return;
    case "aiSlot":
      if (typeof value.slotKey !== "string" || !KEY_RE.test(value.slotKey)) s.issues.push(issue("AST_INVALID", `${path}.slotKey`, "slotKey inválido"));
      else if (s.slotKeys.has(value.slotKey)) s.issues.push(issue("AST_INVALID", `${path}.slotKey`, `slot de IA duplicado: ${value.slotKey}`));
      else s.slotKeys.add(value.slotKey);
      if (!Number.isSafeInteger(value.maxTokens) || (value.maxTokens as number) <= 0) s.issues.push(issue("AST_INVALID", `${path}.maxTokens`, "maxTokens deve ser inteiro positivo"));
      if (typeof value.instructionsKey !== "string" || !KEY_RE.test(value.instructionsKey)) s.issues.push(issue("AST_INVALID", `${path}.instructionsKey`, "instructionsKey inválido"));
      return;
  }
}

/** Valida o AST contra a whitelist e o catálogo. Recebe `unknown` porque o AST pode vir de import ou de persistência. */
export function validateTemplateAst(ast: unknown, catalog: VariableCatalog): TemplateResult<TemplateAST> {
  if (!isPlainObject(ast)) return fail([issue("AST_INVALID", "", "AST deve ser objeto")]);
  const rootIssues = closedKeyIssues(ast, ["schema", "root"], ["schema", "root"], "");
  if (rootIssues.length) return fail(rootIssues);
  if (ast.schema !== "tpl-ast/1") return fail([issue("AST_INVALID", "schema", "schema deve ser tpl-ast/1")]);
  const s: WalkState = { catalog, issues: [], slotKeys: new Set(), annexIds: new Set() };
  walkNodes(ast.root, "root", 1, s);
  return s.issues.length ? fail(s.issues) : ok(ast as unknown as TemplateAST);
}

/** Variáveis referenciadas pelo AST (em `var` e em condições), ordenadas e sem repetição. */
export function referencedVariables(ast: TemplateAST): string[] {
  const names = new Set<string>();
  const fromCond = (c: Cond): void => {
    if (c.op === "and" || c.op === "or") c.of.forEach(fromCond);
    else if (c.op === "not") fromCond(c.of);
    else if ("var" in c) names.add(c.var);
  };
  const fromInline = (i: Inline): void => {
    if (i.t === "var") names.add(i.name);
    else if (i.t === "strong" || i.t === "em") i.v.forEach(fromInline);
  };
  const fromNodes = (ns: readonly TemplateNode[]): void => ns.forEach((n) => {
    switch (n.t) {
      case "heading": n.text.forEach(fromInline); break;
      case "paragraph": n.inline.forEach(fromInline); break;
      case "list": n.items.forEach(fromNodes); break;
      case "table": n.header.forEach((h) => h.forEach(fromInline)); n.rows.forEach((r) => r.forEach((c) => c.forEach(fromInline))); break;
      case "section": fromNodes(n.children); break;
      case "conditional": fromCond(n.when); fromNodes(n.then); if (n.else) fromNodes(n.else); break;
      case "annex": n.title.forEach(fromInline); fromNodes(n.children); break;
      case "docRef": case "aiSlot": break;
    }
  });
  fromNodes(ast.root);
  return [...names].sort();
}
