/**
 * Fatos estruturais do AST para a matriz de prontidão e o dossiê de pré-visualização — domínio puro (não executa nada).
 * Separa variáveis usadas no TEXTO das usadas só em CONDIÇÕES (entradas "control-only"), e levanta tabelas dinâmicas,
 * anexos, referências oficiais (docRef) e slots de IA.
 */
import type { Cond } from "../conditionalDsl";
import type { TemplateAST, TemplateNode, Inline, DocRefKind } from "../ast";
import { findVariable, type VariableCatalog } from "../variableCatalog";

export interface AstFacts {
  readonly textVariables: readonly string[];
  readonly conditionVariables: readonly string[];
  /** Condições distintas (JSON canônico por nó) e quantas vezes aparecem. */
  readonly conditionalCount: number;
  readonly sectionKeys: readonly string[];
  readonly duplicateSectionKeys: readonly string[];
  readonly annexIds: readonly string[];
  readonly docRefs: readonly { readonly kind: DocRefKind; readonly where: "BODY" | "ANNEX"; readonly annexId?: string }[];
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

export function analyzeAst(ast: TemplateAST, catalog: VariableCatalog | null): AstFacts {
  const text = new Set<string>();
  const conds = new Set<string>();
  const sectionKeys: string[] = [];
  const annexIds: string[] = [];
  const docRefs: { kind: DocRefKind; where: "BODY" | "ANNEX"; annexId?: string }[] = [];
  const aiSlots: { slotKey: string; maxTokens: number; instructionsKey: string }[] = [];
  const dynamicTables: { path: string; columns: number; dynamicVariables: string[] }[] = [];
  let conditionalCount = 0;

  const isDynamic = (name: string): boolean => {
    const def = catalog ? findVariable(catalog, name) : undefined;
    return !!def && (def.type === "list" || def.source === "ITEMS");
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
    textVariables: [...text].sort(), conditionVariables: [...conds].sort(), conditionalCount,
    sectionKeys, duplicateSectionKeys: [...dup].sort(), annexIds, docRefs, aiSlots, dynamicTables,
  };
}
