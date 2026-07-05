# Scalability

## Metas

O Knowledge Graph foi projetado para operar em escala institucional:

- **100 mil nós** por organização.
- **1 milhão de arestas** por organização.

Atingir essas metas exige que a travessia e as consultas sejam eficientes em
tempo e memória, e que o trabalho seja empurrado para o SQL sempre que possível.

## Traversal

### DFS iterativo em vez de recursivo

A travessia recursiva estoura a pilha de chamadas em grafos grandes e é difícil
de limitar. Foi substituída por **DFS iterativo com stack explícita**, que
controla profundidade e evita stack overflow:

```ts
function traverse(startId: string, adjacency: AdjacencyMap): string[] {
  const stack = [startId];
  const visited = new Set<string>();
  while (stack.length) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return [...visited];
}
```

### Adjacency map O(V+E)

A vizinhança é pré-computada em um **adjacency map** (`Map<nodeId, nodeId[]>`),
reduzindo a travessia de O(V·E) — varrer todas as arestas a cada nó — para
**O(V+E)**. Cada aresta é visitada uma única vez.

### Dijkstra para shortest path ponderado

Quando arestas têm peso (relevância, distância semântica), o caminho mais curto
usa **Dijkstra** com fila de prioridade, em vez de BFS não ponderado, garantindo
o caminho de menor custo real.

## SQL-first

O máximo de trabalho é feito no banco, não em memória:

- **Paginação SQL** — `LIMIT`/`OFFSET` (ou keyset) para nunca carregar todos os
  nós de uma vez.
- **Filtragem no banco** — buscas por `node_type`, `active` e texto são cláusulas
  `WHERE`, não filtros em memória.
- **Lazy loading** — subgrafos são carregados sob demanda, à medida que a
  travessia avança, e não em bloco.

## Índices

O schema define índices compostos alinhados aos padrões de acesso:

| Índice | Uso |
|---|---|
| `(organization_id, source_node_id)` | arestas de saída por tenant |
| `(organization_id, target_node_id)` | arestas de entrada por tenant |
| `relationship_type` | filtro por tipo de relação |
| `active` | ignorar soft-deleted |
| `node_type` | busca de nós por categoria |

Os índices compostos começam sempre por `organization_id`, refletindo que
**toda** query é multi-tenant.

## Cache de adjacência

Para travessias repetidas dentro de uma mesma requisição (ou janela curta), o
adjacency map é mantido em **cache de adjacência**, evitando reconstruir a
vizinhança a cada expansão.

## Estratégias futuras

Para escalar além das metas atuais:

- **Subgrafo por tenant** — carregar apenas a fração do grafo relevante à
  organização/consulta, nunca o grafo global.
- **Batched loading** — buscar arestas de múltiplos nós em uma única query
  (`WHERE source_node_id IN (...)`), reduzindo round-trips.
- **Cache de adjacência persistente** — materializar vizinhanças quentes para
  travessias recorrentes.

## Resumo

| Antes | Depois |
|---|---|
| DFS recursivo (stack overflow) | DFS iterativo com stack |
| O(V·E) por travessia | O(V+E) com adjacency map |
| BFS para shortest path | Dijkstra ponderado |
| Filtro em memória | SQL-first + índices compostos |
| Carregamento total | Lazy loading + paginação SQL |

Essas escolhas mantêm o Knowledge Graph performático nas metas de 100 mil nós e
1 milhão de arestas, com caminho claro de evolução.
