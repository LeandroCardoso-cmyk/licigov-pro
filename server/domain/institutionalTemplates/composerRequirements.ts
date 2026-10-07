/**
 * Pins oficiais (tipos) e slots de IA exigidos por um AST `tpl-ast/1`, sem renderizar. Extraído de `composer.ts` sem
 * alterar o comportamento (o composer reexporta); vive aqui para o despacho por versão não importar o composer.
 */
import type { DocRefKind, TemplateNode } from "./ast";

/** AST: nós `docRef` e chaves de `aiSlot` (em ordem), sem renderizar. */
export function templateRequirements(nodes: readonly TemplateNode[]): { docRefKinds: DocRefKind[]; aiSlots: string[] } {
  const kinds = new Set<DocRefKind>();
  const slots: string[] = [];
  const walk = (ns: readonly TemplateNode[]): void => ns.forEach((n) => {
    switch (n.t) {
      case "list": n.items.forEach(walk); break;
      case "section": walk(n.children); break;
      case "conditional": walk(n.then); if (n.else) walk(n.else); break;
      case "annex": walk(n.children); break;
      case "docRef": kinds.add(n.kind); break;
      case "aiSlot": slots.push(n.slotKey); break;
      default: break;
    }
  });
  walk(nodes);
  return { docRefKinds: [...kinds].sort(), aiSlots: slots };
}
