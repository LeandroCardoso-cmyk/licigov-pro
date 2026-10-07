/** Resumo estrutural do AST (contagens e chaves) para a UX e a explicabilidade. Puro; não executa nada. */
import {
  isAstV2, referencedVariables, referencedVariables2, type AnyTemplateAST, type TemplateAST2, type TemplateNode, type TemplateNode2,
} from "../../domain/institutionalTemplates";

export interface AstSummary {
  readonly nodeCount: number;
  readonly nodesByType: Readonly<Record<string, number>>;
  readonly sectionKeys: readonly string[];
  readonly aiSlotKeys: readonly string[];
  readonly annexIds: readonly string[];
  readonly docRefKinds: readonly string[];
  readonly conditionalCount: number;
  readonly variables: readonly string[];
}

function summarizeAst2(ast: TemplateAST2): AstSummary {
  const nodesByType: Record<string, number> = {};
  const sectionKeys: string[] = [];
  const aiSlotKeys: string[] = [];
  const annexIds: string[] = [];
  const docRefKinds = new Set<string>();
  let nodeCount = 0;
  const visit = (nodes: readonly TemplateNode2[]): void => {
    for (const n of nodes) {
      nodeCount++;
      nodesByType[n.t] = (nodesByType[n.t] ?? 0) + 1;
      switch (n.t) {
        case "section": sectionKeys.push(n.key); visit(n.children); break;
        case "conditional": visit(n.then); if (n.else) visit(n.else); break;
        case "choice": n.branches.forEach((b) => visit(b.children)); break;
        case "list": n.items.forEach(visit); break;
        case "annex": annexIds.push(n.id); visit(n.children); break;
        case "aiSlot": aiSlotKeys.push(n.slotKey); break;
        case "docRef": docRefKinds.add(n.kind); break;
        default: break;
      }
    }
  };
  visit(ast.root);
  return {
    nodeCount, nodesByType, sectionKeys, aiSlotKeys, annexIds, docRefKinds: [...docRefKinds].sort(),
    // grupos excludentes contam como condicionais (cada ramo é uma decisão condicional)
    conditionalCount: (nodesByType.conditional ?? 0) + (nodesByType.choice ?? 0), variables: referencedVariables2(ast),
  };
}

export function summarizeAst(ast: AnyTemplateAST): AstSummary {
  if (isAstV2(ast)) return summarizeAst2(ast);
  const nodesByType: Record<string, number> = {};
  const sectionKeys: string[] = [];
  const aiSlotKeys: string[] = [];
  const annexIds: string[] = [];
  const docRefKinds = new Set<string>();
  let nodeCount = 0;
  const visit = (nodes: readonly TemplateNode[]): void => {
    for (const n of nodes) {
      nodeCount++;
      nodesByType[n.t] = (nodesByType[n.t] ?? 0) + 1;
      switch (n.t) {
        case "section": sectionKeys.push(n.key); visit(n.children); break;
        case "conditional": visit(n.then); if (n.else) visit(n.else); break;
        case "list": n.items.forEach(visit); break;
        case "annex": annexIds.push(n.id); visit(n.children); break;
        case "aiSlot": aiSlotKeys.push(n.slotKey); break;
        case "docRef": docRefKinds.add(n.kind); break;
        default: break;
      }
    }
  };
  visit(ast.root);
  return {
    nodeCount, nodesByType, sectionKeys, aiSlotKeys, annexIds,
    docRefKinds: [...docRefKinds].sort(), conditionalCount: nodesByType.conditional ?? 0, variables: referencedVariables(ast),
  };
}
