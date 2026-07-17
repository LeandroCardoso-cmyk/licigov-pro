/**
 * RC-X.2 — Institutional Bootstrap Framework · Dependency Resolution (Part 4).
 *
 * Grafo de dependências entre subsistemas de bootstrap. Garante ordem DETERMINÍSTICA (Kahn com
 * desempate por id), dependências explícitas, ausência de ciclos e replay-safety. Puro.
 */

export interface BootstrapDependencyGraph {
  readonly nodes: readonly string[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
}

export interface HasDependencies {
  readonly id: string;
  readonly dependencies: readonly string[];
}

/** Constrói o grafo a partir de itens com dependências. Arestas: dependência → dependente. */
export function buildDependencyGraph(items: readonly HasDependencies[]): BootstrapDependencyGraph {
  const nodes = [...items.map(i => i.id)].sort((a, b) => a.localeCompare(b));
  const ids = new Set(nodes);
  const edges: { from: string; to: string }[] = [];
  for (const item of items) {
    for (const dep of item.dependencies) {
      if (ids.has(dep)) edges.push({ from: dep, to: item.id });
    }
  }
  edges.sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`));
  return { nodes, edges };
}

/** Detecta ciclo no grafo (DFS por coloração). */
export function hasCycle(graph: BootstrapDependencyGraph): boolean {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n, []);
  for (const e of graph.edges) adj.get(e.from)!.push(e.to);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(graph.nodes.map(n => [n, WHITE]));
  const dfs = (n: string): boolean => {
    color.set(n, GRAY);
    for (const m of adj.get(n) ?? []) {
      const c = color.get(m);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(m)) return true;
    }
    color.set(n, BLACK);
    return false;
  };
  return graph.nodes.some(n => color.get(n) === WHITE && dfs(n));
}

/**
 * Ordem topológica DETERMINÍSTICA (Kahn). A cada passo escolhe o menor id disponível
 * (in-degree 0). Lança se houver ciclo. Replay-safe.
 */
export function topologicalOrder(graph: BootstrapDependencyGraph): string[] {
  const inDegree = new Map<string, number>(graph.nodes.map(n => [n, 0]));
  const adj = new Map<string, string[]>(graph.nodes.map(n => [n, []]));
  for (const e of graph.edges) {
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }
  const available = graph.nodes.filter(n => (inDegree.get(n) ?? 0) === 0).sort((a, b) => a.localeCompare(b));
  const order: string[] = [];
  while (available.length > 0) {
    const n = available.shift()!;
    order.push(n);
    for (const m of [...(adj.get(n) ?? [])].sort((a, b) => a.localeCompare(b))) {
      inDegree.set(m, (inDegree.get(m) ?? 0) - 1);
      if (inDegree.get(m) === 0) {
        available.push(m);
        available.sort((a, b) => a.localeCompare(b));
      }
    }
  }
  if (order.length !== graph.nodes.length) throw new Error("bootstrap: ciclo de dependências detectado");
  return order;
}

/** Dependências diretas de um nó. */
export function directDependencies(graph: BootstrapDependencyGraph, id: string): string[] {
  return graph.edges.filter(e => e.to === id).map(e => e.from).sort((a, b) => a.localeCompare(b));
}

/** Dependentes diretos de um nó. */
export function directDependents(graph: BootstrapDependencyGraph, id: string): string[] {
  return graph.edges.filter(e => e.from === id).map(e => e.to).sort((a, b) => a.localeCompare(b));
}
