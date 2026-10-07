/**
 * Fatos estruturais do AST para a matriz de prontidão e o dossiê de pré-visualização — domínio puro (não executa nada).
 * Separa variáveis usadas no TEXTO das usadas só em CONDIÇÕES (entradas "control-only"), e levanta tabelas dinâmicas,
 * anexos, referências oficiais (docRef) e slots de IA.
 */
import type { Cond } from "../conditionalDsl";
import type { TemplateNode, Inline } from "../ast";
import type { Inline2, TemplateNode2 } from "../ast2";
import { isAstV2, findAnyVariable, type AnyTemplateAST, type AnyVariableCatalog } from "../astVersions";
import { conditionVariables } from "../conditionalDsl2";

export interface AstFacts {
  readonly textVariables: readonly string[];
  readonly conditionVariables: readonly string[];
  /** Variáveis que só decidem a visibilidade de COLUNAS de tabelas dinâmicas (não são tipos de condição de bloco). */
  readonly columnConditionVariables: readonly string[];
  /** Controles declarados por `controlRef` (dependência de validação, sem render): não são tipos de condição de bloco. */
  readonly controlRefVariables: readonly string[];
  /** Âncoras de parágrafo (alvos de remissão). */
  readonly anchors: readonly string[];
  /** Condições distintas (JSON canônico por nó) e quantas vezes aparecem. */
  readonly conditionalCount: number;
  readonly sectionKeys: readonly string[];
  readonly duplicateSectionKeys: readonly string[];
  readonly annexIds: readonly string[];
  readonly docRefs: readonly { readonly kind: string; readonly where: "BODY" | "ANNEX"; readonly annexId?: string }[];
  readonly aiSlots: readonly { readonly slotKey: string; readonly maxTokens: number; readonly instructionsKey: string }[];
  readonly dynamicTables: readonly { readonly path: string; readonly columns: number; readonly dynamicVariables: readonly string[] }[];
}

const condVars = (c: Cond, into: Set<string>): void => {
  if (c.op === "and" || c.op === "or") c.of.forEach((x) => condVars(x, into));
  else if (c.op === "not") condVars(c.of, into);
  else if ("var" in c) into.add(c.var);
};

const inlineVars = (inl: readonly Inline[], into: Set<string>): void => inl.forEach((i) => {
  if (i.t === "var") into.add(i.name);
  else if (i.t === "strong" || i.t === "em") inlineVars(i.v, into);
});

export function analyzeAst(ast: AnyTemplateAST, catalog: AnyVariableCatalog | null): AstFacts {
  if (isAstV2(ast)) return analyzeAst2(ast.root, catalog);
  const text = new Set<string>();
  const conds = new Set<string>();
  const sectionKeys: string[] = [];
  const annexIds: string[] = [];
  const docRefs: { kind: string; where: "BODY" | "ANNEX"; annexId?: string }[] = [];
  const aiSlots: { slotKey: string; maxTokens: number; instructionsKey: string }[] = [];
  const dynamicTables: { path: string; columns: number; dynamicVariables: string[] }[] = [];
  let conditionalCount = 0;

  const isDynamic = (name: string): boolean => {
    const def = catalog ? findAnyVariable(catalog, name) : undefined;
    return !!def && (def.type === "list" || def.type === "table" || def.source === "ITEMS");
  };

  const visit = (nodes: readonly TemplateNode[], path: string, annexId?: string): void => nodes.forEach((n, idx) => {
    const p = `${path}[${idx}]`;
    switch (n.t) {
      case "heading": inlineVars(n.text, text); break;
      case "paragraph": inlineVars(n.inline, text); break;
      case "list": n.items.forEach((it, i) => visit(it, `${p}.items[${i}]`, annexId)); break;
      case "table": {
        const vars = new Set<string>();
        n.header.forEach((h) => inlineVars(h, vars));
        n.rows.forEach((r) => r.forEach((c) => inlineVars(c, vars)));
        vars.forEach((v) => text.add(v));
        const dyn = [...vars].filter(isDynamic).sort();
        if (dyn.length) dynamicTables.push({ path: p, columns: n.header.length, dynamicVariables: dyn });
        break;
      }
      case "section": sectionKeys.push(n.key); visit(n.children, `${p}.children`, annexId); break;
      case "conditional": conditionalCount++; condVars(n.when, conds); visit(n.then, `${p}.then`, annexId); if (n.else) visit(n.else, `${p}.else`, annexId); break;
      case "docRef": docRefs.push({ kind: n.kind, where: annexId ? "ANNEX" : "BODY", ...(annexId ? { annexId } : {}) }); break;
      case "annex": annexIds.push(n.id); inlineVars(n.title, text); visit(n.children, `${p}.children`, n.id); break;
      case "aiSlot": aiSlots.push({ slotKey: n.slotKey, maxTokens: n.maxTokens, instructionsKey: n.instructionsKey }); break;
    }
  });
  visit(ast.root, "root");
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of sectionKeys) { if (seen.has(k)) dup.add(k); seen.add(k); }
  return {
    textVariables: [...text].sort(), conditionVariables: [...conds].sort(), columnConditionVariables: [], controlRefVariables: [], anchors: [], conditionalCount,
    sectionKeys, duplicateSectionKeys: [...dup].sort(), annexIds, docRefs, aiSlots, dynamicTables,
  };
}

// ─── tpl-ast/2 ─────────────────────────────────────────────────────────────────────────────────────────────────────

const inline2Vars = (inl: readonly Inline2[], text: Set<string>, conds: Set<string>, slots: { slotKey: string; maxTokens: number; instructionsKey: string }[]): void => inl.forEach((i) => {
  switch (i.t) {
    case "var": text.add(i.name); break;
    case "strong": case "em": inline2Vars(i.v, text, conds, slots); break;
    case "when": conditionVariables(i.when).forEach((v) => conds.add(v)); inline2Vars(i.then, text, conds, slots); break;
    case "aiSlot": slots.push({ slotKey: i.slotKey, maxTokens: i.maxTokens, instructionsKey: i.instructionsKey }); break;
    default: break;
  }
});

function analyzeAst2(root: readonly TemplateNode2[], catalog: AnyVariableCatalog | null): AstFacts {
  const text = new Set<string>();
  const conds = new Set<string>();
  const sectionKeys: string[] = [];
  const annexIds: string[] = [];
  const docRefs: { kind: string; where: "BODY" | "ANNEX"; annexId?: string }[] = [];
  const aiSlots: { slotKey: string; maxTokens: number; instructionsKey: string }[] = [];
  const dynamicTables: { path: string; columns: number; dynamicVariables: string[] }[] = [];
  const colConds = new Set<string>();
  const ctrlRefs = new Set<string>();
  const anchors: string[] = [];
  let conditionalCount = 0;

  const visit = (nodes: readonly TemplateNode2[], path: string, annexId?: string): void => nodes.forEach((n, idx) => {
    const p = `${path}[${idx}]`;
    switch (n.t) {
      case "heading": inline2Vars(n.text, text, conds, aiSlots); break;
      case "paragraph": inline2Vars(n.inline, text, conds, aiSlots); if (n.anchor) anchors.push(n.anchor); break;
      case "list": n.items.forEach((it, i) => visit(it, `${p}.items[${i}]`, annexId)); break;
      case "table": {
        n.header.forEach((h) => inline2Vars(h, text, conds, aiSlots));
        n.rows.forEach((r) => r.forEach((c) => inline2Vars(c, text, conds, aiSlots)));
        break;
      }
      case "dataTable": {
        // A tabela dinâmica referencia a variável `table` do catálogo (fonte governada); colunas podem ser condicionais.
        text.add(n.source);
        n.columns.forEach((c) => { inline2Vars(c.header, text, conds, aiSlots); if (c.when) conditionVariables(c.when).forEach((v) => colConds.add(v)); });
        dynamicTables.push({ path: p, columns: n.columns.length, dynamicVariables: [n.source] });
        break;
      }
      case "section": sectionKeys.push(n.key); if (n.title) inline2Vars(n.title, text, conds, aiSlots); visit(n.children, `${p}.children`, annexId); break;
      case "conditional": conditionalCount++; conditionVariables(n.when).forEach((v) => conds.add(v)); visit(n.then, `${p}.then`, annexId); if (n.else) visit(n.else, `${p}.else`, annexId); break;
      case "choice": conditionalCount++; n.branches.forEach((b, i) => { conditionVariables(b.when).forEach((v) => conds.add(v)); visit(b.children, `${p}.branches[${i}]`, annexId); }); break;
      case "docRef": docRefs.push({ kind: n.kind, where: annexId ? "ANNEX" : "BODY", ...(annexId ? { annexId } : {}) }); if (n.label) inline2Vars(n.label, text, conds, aiSlots); break;
      case "annex": annexIds.push(n.id); inline2Vars(n.title, text, conds, aiSlots); visit(n.children, `${p}.children`, n.id); break;
      case "aiSlot": aiSlots.push({ slotKey: n.slotKey, maxTokens: n.maxTokens, instructionsKey: n.instructionsKey }); break;
      case "controlRef": ctrlRefs.add(n.var); break;
    }
  });
  visit(root, "root");
  void catalog;
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of sectionKeys) { if (seen.has(k)) dup.add(k); seen.add(k); }
  return {
    textVariables: [...text].sort(), conditionVariables: [...conds].sort(), columnConditionVariables: [...colConds].sort(), controlRefVariables: [...ctrlRefs].sort(), anchors: [...new Set(anchors)].sort(), conditionalCount,
    sectionKeys, duplicateSectionKeys: [...dup].sort(), annexIds, docRefs, aiSlots, dynamicTables,
  };
}
