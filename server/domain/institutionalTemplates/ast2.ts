/**
 * TemplateAST v2 (`tpl-ast/2`) — representação CANÔNICA reutilizável de modelos documentais institucionais.
 *
 * O `tpl-ast/1` (`ast.ts`) continua válido e reproduzível: este módulo é paralelo e NUNCA reinterpreta AST v1. Mesma
 * disciplina do v1: conjunto FECHADO de nós e de propriedades; nó, propriedade ou operador desconhecido ⇒ recusa; nada
 * aqui é executado (texto é literal, `var` só referencia o catálogo v2, `aiSlot` é o ÚNICO ponto de IA).
 *
 * O que o v2 acrescenta (genérico — não existe nada específico de modalidade, plataforma ou modelo):
 *  - `dataTable`: tabela dinâmica que referencia uma variável `table` do catálogo (fonte governada) e escolhe/ordena
 *    colunas; as linhas nunca são serializadas no modelo;
 *  - âncoras + `xref`: remissão estrutural a uma âncora (seção numerada, parágrafo numerado ou anexo). O número final é
 *    resolvido pelo renderer DEPOIS das condicionais — a autoridade da remissão nunca é um texto como "item 15.4";
 *  - `section` com numeração automática; `paragraph` numerável e ancorável;
 *  - `choice`: grupo excludente (`exactly-one` / `at-most-one`) de ramos condicionais;
 *  - `docRef` com `role` e `order` (e rótulo opcional), sempre `EXACT_PINNED` — sem "latest";
 *  - `annex` com id estável, `role`, `order`, título e conteúdo;
 *  - `var` só de variável RENDERIZÁVEL: controles (`renderable=false`) são recusados como texto.
 * Condições usam a DSL fechada v2 (`conditionalDsl2.ts`). Profundidade ≤ MAX_AST_DEPTH (guarda técnica do owner R-6).
 */
import { MAX_AST_DEPTH, KEY_RE, closedKeyIssues, isPlainObject, type DocRefKind } from "./ast";
import { conditionVariables, validateCondition2, type Cond2 } from "./conditionalDsl2";
import { fail, issue, ok, type TemplateIssue, type TemplateResult } from "./types";
import { findVariable2, type VariableCatalog2 } from "./variableCatalog2";

export const AST_SCHEMA_2 = "tpl-ast/2" as const;

/** Tipos de documento oficial referenciáveis (sempre por pin exato). Aditivo sobre o v1. */
export type DocRefKind2 = DocRefKind | "EDITAL" | "CONTRATO" | "PARECER";
export const DOC_REF_KINDS_2: readonly DocRefKind2[] = ["TR", "ETP", "DFD", "ANNEX", "EDITAL", "CONTRATO", "PARECER"];

export type Inline2 =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "var"; readonly name: string }
  | { readonly t: "strong" | "em"; readonly v: readonly Inline2[] }
  | { readonly t: "xref"; readonly target: string };
export type TextExpr2 = readonly Inline2[];

export type ChoiceMode = "exactly-one" | "at-most-one";
export interface ChoiceBranch {
  readonly key: string;
  readonly when: Cond2;
  readonly children: readonly TemplateNode2[];
}
export interface DataTableColumn {
  /** Chave da coluna no esquema da variável `table` do catálogo. */
  readonly key: string;
  readonly header: TextExpr2;
}

export type TemplateNode2 =
  | { readonly t: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly text: TextExpr2 }
  | { readonly t: "paragraph"; readonly inline: readonly Inline2[]; readonly numbered?: boolean; readonly anchor?: string }
  | { readonly t: "list"; readonly ordered: boolean; readonly items: readonly (readonly TemplateNode2[])[] }
  | { readonly t: "table"; readonly header: readonly TextExpr2[]; readonly rows: readonly (readonly TextExpr2[])[] }
  | { readonly t: "dataTable"; readonly tableKey: string; readonly source: string; readonly columns: readonly DataTableColumn[] }
  | { readonly t: "section"; readonly key: string; readonly numbering: "auto" | "none"; readonly title?: TextExpr2; readonly legalRef?: string; readonly children: readonly TemplateNode2[] }
  | { readonly t: "conditional"; readonly when: Cond2; readonly then: readonly TemplateNode2[]; readonly else?: readonly TemplateNode2[] }
  | { readonly t: "choice"; readonly groupKey: string; readonly mode: ChoiceMode; readonly branches: readonly ChoiceBranch[] }
  | { readonly t: "docRef"; readonly kind: DocRefKind2; readonly mode: "EXACT_PINNED"; readonly role: string; readonly order: number; readonly label?: TextExpr2 }
  | { readonly t: "annex"; readonly id: string; readonly role: string; readonly order: number; readonly title: TextExpr2; readonly children: readonly TemplateNode2[] }
  | { readonly t: "aiSlot"; readonly slotKey: string; readonly maxTokens: number; readonly instructionsKey: string };

export interface TemplateAST2 {
  readonly schema: typeof AST_SCHEMA_2;
  readonly root: readonly TemplateNode2[];
}

/** Guarda técnica de implementação (não regra jurídica): limita o nº de nós de um AST v2. Mudança ⇒ nova versão do schema. */
export const MAX_AST_NODES_2 = 20000;

const NODE_KEYS: Record<TemplateNode2["t"], { readonly required: readonly string[]; readonly optional: readonly string[] }> = {
  heading: { required: ["t", "level", "text"], optional: [] },
  paragraph: { required: ["t", "inline"], optional: ["numbered", "anchor"] },
  list: { required: ["t", "ordered", "items"], optional: [] },
  table: { required: ["t", "header", "rows"], optional: [] },
  dataTable: { required: ["t", "tableKey", "source", "columns"], optional: [] },
  section: { required: ["t", "key", "numbering", "children"], optional: ["title", "legalRef"] },
  conditional: { required: ["t", "when", "then"], optional: ["else"] },
  choice: { required: ["t", "groupKey", "mode", "branches"], optional: [] },
  docRef: { required: ["t", "kind", "mode", "role", "order"], optional: ["label"] },
  annex: { required: ["t", "id", "role", "order", "title", "children"], optional: [] },
  aiSlot: { required: ["t", "slotKey", "maxTokens", "instructionsKey"], optional: [] },
};
const INLINE_KEYS: Record<Inline2["t"], readonly string[]> = {
  text: ["t", "v"], var: ["t", "name"], strong: ["t", "v"], em: ["t", "v"], xref: ["t", "target"],
};

type AnchorKind = "section" | "paragraph" | "annex";
interface Anchor { readonly kind: AnchorKind; readonly numbered: boolean }
interface Ctx {
  /** `annex` só é admitido na raiz ou dentro de `conditional`/`choice` que estejam na raiz (nunca em seção/lista/anexo). */
  readonly annexAllowed: boolean;
}
interface WalkState {
  readonly catalog: VariableCatalog2;
  readonly issues: TemplateIssue[];
  readonly anchors: Map<string, Anchor>;
  readonly xrefs: { target: string; path: string }[];
  readonly slotKeys: Set<string>;
  readonly tableKeys: Set<string>;
  readonly groupKeys: Set<string>;
  readonly docRoles: Set<string>;
  readonly docOrders: Set<number>;
  readonly annexRoles: Set<string>;
  readonly annexOrders: Set<number>;
  nodes: number;
}

function addAnchor(s: WalkState, key: string, anchor: Anchor, path: string): void {
  if (s.anchors.has(key)) s.issues.push(issue("ANCHOR_DUPLICATE", path, `âncora duplicada: ${key}`));
  else s.anchors.set(key, anchor);
}

function walkInline(value: unknown, path: string, depth: number, s: WalkState): void {
  if (depth > MAX_AST_DEPTH) { s.issues.push(issue("AST_DEPTH_EXCEEDED", path, `profundidade máxima ${MAX_AST_DEPTH}`)); return; }
  if (!isPlainObject(value) || typeof value.t !== "string" || !Object.prototype.hasOwnProperty.call(INLINE_KEYS, value.t)) {
    s.issues.push(issue("AST_UNKNOWN_NODE", path, `inline fora da whitelist: ${isPlainObject(value) ? String(value.t) : typeof value}`));
    return;
  }
  const t = value.t as Inline2["t"];
  const keyIssues = closedKeyIssues(value, INLINE_KEYS[t], INLINE_KEYS[t], path);
  if (keyIssues.length) { s.issues.push(...keyIssues); return; }
  if (t === "text") {
    if (typeof value.v !== "string") s.issues.push(issue("AST_INVALID", `${path}.v`, "texto deve ser string"));
  } else if (t === "var") {
    const def = typeof value.name === "string" ? findVariable2(s.catalog, value.name) : undefined;
    if (!def) s.issues.push(issue("UNKNOWN_VARIABLE", `${path}.name`, `variável fora do catálogo ${s.catalog.version}: ${String(value.name)}`));
    else if (!def.renderable) s.issues.push(issue("CONTROL_ONLY_VARIABLE_RENDERED", `${path}.name`, `${def.name} é um controle (renderable=false): participa de condição/validação, nunca de texto`));
    else if (def.type === "table") s.issues.push(issue("TABLE_BINDING_INVALID", `${path}.name`, `${def.name} é tabela: use um nó dataTable`));
  } else if (t === "xref") {
    if (typeof value.target !== "string" || !KEY_RE.test(value.target)) s.issues.push(issue("AST_INVALID", `${path}.target`, "alvo da remissão inválido"));
    else s.xrefs.push({ target: value.target, path });
  } else {
    walkInlineList(value.v, `${path}.v`, depth + 1, s);
  }
}

function walkInlineList(value: unknown, path: string, depth: number, s: WalkState): void {
  if (!Array.isArray(value)) { s.issues.push(issue("AST_INVALID", path, "esperada lista de inlines")); return; }
  value.forEach((v, i) => walkInline(v, `${path}[${i}]`, depth, s));
}

function walkNodes(value: unknown, path: string, depth: number, ctx: Ctx, s: WalkState): void {
  if (!Array.isArray(value)) { s.issues.push(issue("AST_INVALID", path, "esperada lista de nós")); return; }
  value.forEach((n, i) => walkNode(n, `${path}[${i}]`, depth, ctx, s));
}

function posInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
}

function walkNode(value: unknown, path: string, depth: number, ctx: Ctx, s: WalkState): void {
  if (++s.nodes > MAX_AST_NODES_2) {
    if (s.nodes === MAX_AST_NODES_2 + 1) s.issues.push(issue("AST_INVALID", path, `AST excede ${MAX_AST_NODES_2} nós`));
    return;
  }
  if (depth > MAX_AST_DEPTH) { s.issues.push(issue("AST_DEPTH_EXCEEDED", path, `profundidade máxima ${MAX_AST_DEPTH}`)); return; }
  if (!isPlainObject(value) || typeof value.t !== "string" || !Object.prototype.hasOwnProperty.call(NODE_KEYS, value.t)) {
    s.issues.push(issue("AST_UNKNOWN_NODE", path, `nó fora da whitelist: ${isPlainObject(value) ? String(value.t) : typeof value}`));
    return;
  }
  const t = value.t as TemplateNode2["t"];
  const spec = NODE_KEYS[t];
  const keyIssues = closedKeyIssues(value, [...spec.required, ...spec.optional], spec.required, path);
  if (keyIssues.length) { s.issues.push(...keyIssues); return; }
  const inner: Ctx = { annexAllowed: false };

  switch (t) {
    case "heading":
      if (![1, 2, 3, 4, 5, 6].includes(value.level as number)) s.issues.push(issue("AST_INVALID", `${path}.level`, "nível de título deve ser 1–6"));
      walkInlineList(value.text, `${path}.text`, depth + 1, s);
      return;
    case "paragraph": {
      walkInlineList(value.inline, `${path}.inline`, depth + 1, s);
      if (value.numbered !== undefined && typeof value.numbered !== "boolean") s.issues.push(issue("AST_INVALID", `${path}.numbered`, "numbered deve ser booleano"));
      if (value.anchor !== undefined) {
        if (typeof value.anchor !== "string" || !KEY_RE.test(value.anchor)) s.issues.push(issue("AST_INVALID", `${path}.anchor`, "âncora inválida"));
        else if (value.numbered !== true) s.issues.push(issue("AST_INVALID", `${path}.anchor`, "parágrafo âncora precisa ser numerado (numbered: true)"));
        else addAnchor(s, value.anchor, { kind: "paragraph", numbered: true }, `${path}.anchor`);
      }
      return;
    }
    case "list":
      if (typeof value.ordered !== "boolean") s.issues.push(issue("AST_INVALID", `${path}.ordered`, "ordered deve ser booleano"));
      if (!Array.isArray(value.items)) { s.issues.push(issue("AST_INVALID", `${path}.items`, "items deve ser lista")); return; }
      value.items.forEach((item, i) => walkNodes(item, `${path}.items[${i}]`, depth + 1, inner, s));
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
    case "dataTable": {
      if (typeof value.tableKey !== "string" || !KEY_RE.test(value.tableKey)) s.issues.push(issue("AST_INVALID", `${path}.tableKey`, "tableKey inválida"));
      else if (s.tableKeys.has(value.tableKey)) s.issues.push(issue("AST_INVALID", `${path}.tableKey`, `tabela dinâmica duplicada: ${value.tableKey}`));
      else s.tableKeys.add(value.tableKey);
      const def = typeof value.source === "string" ? findVariable2(s.catalog, value.source) : undefined;
      if (!def) { s.issues.push(issue("UNKNOWN_VARIABLE", `${path}.source`, `fonte da tabela fora do catálogo ${s.catalog.version}: ${String(value.source)}`)); return; }
      if (def.type !== "table") { s.issues.push(issue("TABLE_BINDING_INVALID", `${path}.source`, `${def.name} é ${def.type}; dataTable exige variável do tipo table`)); return; }
      if (!def.renderable) s.issues.push(issue("CONTROL_ONLY_VARIABLE_RENDERED", `${path}.source`, `${def.name} é um controle (renderable=false)`));
      if (!Array.isArray(value.columns) || value.columns.length === 0) { s.issues.push(issue("TABLE_BINDING_INVALID", `${path}.columns`, "dataTable exige ao menos uma coluna")); return; }
      const used = new Set<string>();
      value.columns.forEach((c, i) => {
        const cp = `${path}.columns[${i}]`;
        if (!isPlainObject(c)) { s.issues.push(issue("AST_INVALID", cp, "coluna deve ser objeto")); return; }
        const ki = closedKeyIssues(c, ["key", "header"], ["key", "header"], cp);
        if (ki.length) { s.issues.push(...ki); return; }
        if (typeof c.key !== "string" || !(def.columns ?? []).some((x) => x.key === c.key)) {
          s.issues.push(issue("TABLE_BINDING_INVALID", `${cp}.key`, `coluna fora do esquema de ${def.name}: ${String(c.key)}`));
        } else if (used.has(c.key)) s.issues.push(issue("TABLE_BINDING_INVALID", `${cp}.key`, `coluna repetida: ${c.key}`));
        else used.add(c.key);
        walkInlineList(c.header, `${cp}.header`, depth + 1, s);
      });
      return;
    }
    case "section": {
      if (value.numbering !== "auto" && value.numbering !== "none") s.issues.push(issue("AST_INVALID", `${path}.numbering`, "numbering deve ser auto ou none"));
      if (value.numbering === "auto" && value.title === undefined) s.issues.push(issue("AST_INVALID", `${path}.title`, "seção numerada exige título"));
      if (value.title !== undefined) walkInlineList(value.title, `${path}.title`, depth + 1, s);
      if (typeof value.key !== "string" || !KEY_RE.test(value.key)) s.issues.push(issue("AST_INVALID", `${path}.key`, "chave de seção inválida"));
      else addAnchor(s, value.key, { kind: "section", numbered: value.numbering === "auto" }, `${path}.key`);
      if (value.legalRef !== undefined && typeof value.legalRef !== "string") s.issues.push(issue("AST_INVALID", `${path}.legalRef`, "legalRef deve ser string"));
      walkNodes(value.children, `${path}.children`, depth + 1, inner, s);
      return;
    }
    case "conditional":
      s.issues.push(...validateCondition2(value.when, s.catalog, `${path}.when`));
      walkNodes(value.then, `${path}.then`, depth + 1, ctx, s);
      if (value.else !== undefined) walkNodes(value.else, `${path}.else`, depth + 1, ctx, s);
      return;
    case "choice": {
      if (typeof value.groupKey !== "string" || !KEY_RE.test(value.groupKey)) s.issues.push(issue("CHOICE_INVALID", `${path}.groupKey`, "groupKey inválida"));
      else if (s.groupKeys.has(value.groupKey)) s.issues.push(issue("CHOICE_INVALID", `${path}.groupKey`, `grupo excludente duplicado: ${value.groupKey}`));
      else s.groupKeys.add(value.groupKey);
      if (value.mode !== "exactly-one" && value.mode !== "at-most-one") s.issues.push(issue("CHOICE_INVALID", `${path}.mode`, "mode deve ser exactly-one ou at-most-one"));
      if (!Array.isArray(value.branches) || value.branches.length < 2) { s.issues.push(issue("CHOICE_INVALID", `${path}.branches`, "grupo excludente exige ao menos 2 ramos")); return; }
      const keys = new Set<string>();
      value.branches.forEach((b, i) => {
        const bp = `${path}.branches[${i}]`;
        if (!isPlainObject(b)) { s.issues.push(issue("CHOICE_INVALID", bp, "ramo deve ser objeto")); return; }
        const ki = closedKeyIssues(b, ["key", "when", "children"], ["key", "when", "children"], bp);
        if (ki.length) { s.issues.push(...ki); return; }
        if (typeof b.key !== "string" || !KEY_RE.test(b.key)) s.issues.push(issue("CHOICE_INVALID", `${bp}.key`, "chave de ramo inválida"));
        else if (keys.has(b.key)) s.issues.push(issue("CHOICE_INVALID", `${bp}.key`, `ramo duplicado: ${b.key}`));
        else keys.add(b.key);
        s.issues.push(...validateCondition2(b.when, s.catalog, `${bp}.when`));
        walkNodes(b.children, `${bp}.children`, depth + 1, ctx, s);
      });
      return;
    }
    case "docRef": {
      if (!DOC_REF_KINDS_2.includes(value.kind as DocRefKind2)) s.issues.push(issue("DOCREF_INVALID", `${path}.kind`, "tipo de referência fora da whitelist"));
      if (value.mode !== "EXACT_PINNED") s.issues.push(issue("DOCREF_INVALID", `${path}.mode`, "referência oficial só por pin exato (EXACT_PINNED)"));
      if (typeof value.role !== "string" || !KEY_RE.test(value.role)) s.issues.push(issue("DOCREF_INVALID", `${path}.role`, "role inválido"));
      else if (s.docRoles.has(value.role)) s.issues.push(issue("DOCREF_INVALID", `${path}.role`, `role de referência duplicado: ${value.role}`));
      else s.docRoles.add(value.role);
      if (!posInt(value.order)) s.issues.push(issue("DOCREF_INVALID", `${path}.order`, "order deve ser inteiro ≥ 1"));
      else if (s.docOrders.has(value.order)) s.issues.push(issue("DOCREF_INVALID", `${path}.order`, `order de referência duplicada: ${value.order}`));
      else s.docOrders.add(value.order);
      if (value.label !== undefined) walkInlineList(value.label, `${path}.label`, depth + 1, s);
      return;
    }
    case "annex": {
      if (!ctx.annexAllowed) s.issues.push(issue("ANNEX_INVALID", path, "anexo só na raiz do documento (ou em condicional/grupo na raiz)"));
      if (typeof value.id !== "string" || !KEY_RE.test(value.id)) s.issues.push(issue("ANNEX_INVALID", `${path}.id`, "id de anexo inválido"));
      else addAnchor(s, value.id, { kind: "annex", numbered: true }, `${path}.id`);
      if (typeof value.role !== "string" || !KEY_RE.test(value.role)) s.issues.push(issue("ANNEX_INVALID", `${path}.role`, "role de anexo inválido"));
      else if (s.annexRoles.has(value.role)) s.issues.push(issue("ANNEX_INVALID", `${path}.role`, `role de anexo duplicado: ${value.role}`));
      else s.annexRoles.add(value.role);
      if (!posInt(value.order)) s.issues.push(issue("ANNEX_INVALID", `${path}.order`, "order deve ser inteiro ≥ 1"));
      else if (s.annexOrders.has(value.order)) s.issues.push(issue("ANNEX_INVALID", `${path}.order`, `order de anexo duplicada: ${value.order}`));
      else s.annexOrders.add(value.order);
      walkInlineList(value.title, `${path}.title`, depth + 1, s);
      if (!Array.isArray(value.children) || value.children.length === 0) s.issues.push(issue("ANNEX_INVALID", `${path}.children`, "anexo exige conteúdo (nós ou referência oficial)"));
      else walkNodes(value.children, `${path}.children`, depth + 1, inner, s);
      return;
    }
    case "aiSlot":
      if (typeof value.slotKey !== "string" || !KEY_RE.test(value.slotKey)) s.issues.push(issue("AST_INVALID", `${path}.slotKey`, "slotKey inválido"));
      else if (s.slotKeys.has(value.slotKey)) s.issues.push(issue("AST_INVALID", `${path}.slotKey`, `slot de IA duplicado: ${value.slotKey}`));
      else s.slotKeys.add(value.slotKey);
      if (!Number.isSafeInteger(value.maxTokens) || (value.maxTokens as number) <= 0) s.issues.push(issue("AST_INVALID", `${path}.maxTokens`, "maxTokens deve ser inteiro positivo"));
      if (typeof value.instructionsKey !== "string" || !KEY_RE.test(value.instructionsKey)) s.issues.push(issue("AST_INVALID", `${path}.instructionsKey`, "instructionsKey inválido"));
      return;
  }
}

/** Valida o AST v2 contra a whitelist e o catálogo v2. Recebe `unknown` (pode vir de import, compilador ou persistência). */
export function validateTemplateAst2(ast: unknown, catalog: VariableCatalog2): TemplateResult<TemplateAST2> {
  if (!isPlainObject(ast)) return fail([issue("AST_INVALID", "", "AST deve ser objeto")]);
  const rootIssues = closedKeyIssues(ast, ["schema", "root"], ["schema", "root"], "");
  if (rootIssues.length) return fail(rootIssues);
  if (ast.schema !== AST_SCHEMA_2) return fail([issue("AST_INVALID", "schema", `schema deve ser ${AST_SCHEMA_2}`)]);
  const s: WalkState = {
    catalog, issues: [], anchors: new Map(), xrefs: [], slotKeys: new Set(), tableKeys: new Set(), groupKeys: new Set(),
    docRoles: new Set(), docOrders: new Set(), annexRoles: new Set(), annexOrders: new Set(), nodes: 0,
  };
  walkNodes(ast.root, "root", 1, { annexAllowed: true }, s);
  // Remissões: alvo precisa existir e ser NUMERADO (a remissão resolve o número final, nunca um texto literal).
  for (const x of s.xrefs) {
    const a = s.anchors.get(x.target);
    if (!a) s.issues.push(issue("XREF_TARGET_UNKNOWN", x.path, `remissão para âncora inexistente: ${x.target}`));
    else if (!a.numbered) s.issues.push(issue("XREF_TARGET_NOT_NUMBERED", x.path, `a âncora ${x.target} não é numerada`));
  }
  return s.issues.length ? fail(s.issues) : ok(ast as unknown as TemplateAST2);
}

/** Variáveis referenciadas pelo AST v2 (texto, condições, grupos excludentes e fontes de tabelas), ordenadas e sem repetição. */
export function referencedVariables2(ast: TemplateAST2): string[] {
  const names = new Set<string>();
  const fromInline = (i: Inline2): void => {
    if (i.t === "var") names.add(i.name);
    else if (i.t === "strong" || i.t === "em") i.v.forEach(fromInline);
  };
  const fromCond = (c: Cond2): void => conditionVariables(c).forEach((n) => names.add(n));
  const fromNodes = (ns: readonly TemplateNode2[]): void => ns.forEach((n) => {
    switch (n.t) {
      case "heading": n.text.forEach(fromInline); break;
      case "paragraph": n.inline.forEach(fromInline); break;
      case "list": n.items.forEach(fromNodes); break;
      case "table": n.header.forEach((h) => h.forEach(fromInline)); n.rows.forEach((r) => r.forEach((c) => c.forEach(fromInline))); break;
      case "dataTable": names.add(n.source); n.columns.forEach((c) => c.header.forEach(fromInline)); break;
      case "section": n.title?.forEach(fromInline); fromNodes(n.children); break;
      case "conditional": fromCond(n.when); fromNodes(n.then); if (n.else) fromNodes(n.else); break;
      case "choice": n.branches.forEach((b) => { fromCond(b.when); fromNodes(b.children); }); break;
      case "docRef": n.label?.forEach(fromInline); break;
      case "annex": n.title.forEach(fromInline); fromNodes(n.children); break;
      case "aiSlot": break;
    }
  });
  fromNodes(ast.root);
  return [...names].sort();
}

export interface TemplateRequirements2 {
  readonly docRefs: readonly { readonly kind: DocRefKind2; readonly role: string; readonly order: number }[];
  readonly docRefKinds: readonly DocRefKind2[];
  readonly aiSlots: readonly string[];
  readonly annexes: readonly { readonly id: string; readonly role: string; readonly order: number }[];
}

/** Pins oficiais, slots de IA e anexos que o AST exige (sem renderizar). */
export function templateRequirements2(nodes: readonly TemplateNode2[]): TemplateRequirements2 {
  const docRefs: { kind: DocRefKind2; role: string; order: number }[] = [];
  const annexes: { id: string; role: string; order: number }[] = [];
  const aiSlots: string[] = [];
  const walk = (ns: readonly TemplateNode2[]): void => ns.forEach((n) => {
    switch (n.t) {
      case "list": n.items.forEach(walk); break;
      case "section": walk(n.children); break;
      case "conditional": walk(n.then); if (n.else) walk(n.else); break;
      case "choice": n.branches.forEach((b) => walk(b.children)); break;
      case "annex": annexes.push({ id: n.id, role: n.role, order: n.order }); walk(n.children); break;
      case "docRef": docRefs.push({ kind: n.kind, role: n.role, order: n.order }); break;
      case "aiSlot": aiSlots.push(n.slotKey); break;
      default: break;
    }
  });
  walk(nodes);
  return { docRefs, docRefKinds: [...new Set(docRefs.map((d) => d.kind))].sort(), aiSlots, annexes };
}
