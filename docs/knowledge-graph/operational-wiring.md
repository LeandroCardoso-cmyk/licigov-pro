# Operational Wiring — Sprint 4.8.1

## Objetivo

A Sprint 4.8 entregou a **fundação** do Knowledge Graph (tipos, funções de
domínio, schema Drizzle). A Sprint 4.8.1 — *Knowledge Graph Operational Wiring*
— transformou essa fundação em um **módulo operacional real**: cada camada foi
conectada de ponta a ponta, todos os stubs e mocks foram eliminados, e o grafo
passou a ser lido e escrito com persistência multi-tenant e integrado ao RAG
institucional.

## Camadas

O módulo segue uma arquitetura em camadas estritas, onde cada camada só conhece
a camada imediatamente inferior:

```
┌──────────────────────────────────────────────────────────────┐
│  Routers tRPC (tenantProcedure)                                │
│  validação de ontologia + ownership + tenant                  │
├──────────────────────────────────────────────────────────────┤
│  Services                                                      │
│  knowledgeGraphService · graphTraversalService                │
│  ontologyValidationService · graphObservabilityService        │
├──────────────────────────────────────────────────────────────┤
│  Persistence (server/db/knowledgeGraph.ts)                     │
│  repository via getDb() (Drizzle / MySQL)                      │
├──────────────────────────────────────────────────────────────┤
│  Domain (funções puras, IDs SHA-256 determinísticos)          │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
        RAG: institutionalRetrievalService
             .retrieveFromKnowledgeGraph()
```

### 1. Domain (funções puras)

Funções sem efeitos colaterais que constroem nós e arestas, calculam IDs
determinísticos via `createHash('sha256')` e normalizam entradas. Não tocam o
banco, não usam `Date.now()` nem `Math.random()`. Testáveis isoladamente.

### 2. Persistence (repository)

`server/db/knowledgeGraph.ts` centraliza todo o acesso ao banco através do
padrão `getDb()`, que retorna a instância Drizzle ou `null`. Todas as queries
são escopadas por `organization_id`. Nenhum service acessa Drizzle diretamente.

### 3. Services

- **knowledgeGraphService** — orquestra criação/atualização de nós e arestas,
  aplicando validação de ontologia antes de persistir.
- **graphTraversalService** — travessia de arestas (BFS/DFS iterativo, shortest
  path), resolução de vizinhança e subgrafos.
- **ontologyValidationService** — matriz de compatibilidade que rejeita
  relacionamentos inválidos antes da persistência.
- **graphObservabilityService** — métricas, versionamento e change log.

### 4. Routers tRPC

Expostos via `tenantProcedure`, que garante contexto de tenant autenticado.
Cada mutation valida:

1. **Ontologia** — o par (source, target, relationship) é permitido?
2. **Ownership** — os nós pertencem à organização do chamador?
3. **Tenant** — todo dado é filtrado por `organization_id` do contexto.

### 5. RAG

`institutionalRetrievalService.retrieveFromKnowledgeGraph(query, orgId)` usa o
grafo como fonte de evidências, enriquecendo o pipeline de recuperação
institucional (ver `graph-rag-integration.md`).

## Eliminação de stubs e mocks

Antes da Sprint 4.8.1, os services retornavam dados fixos (stubs) e o RAG
ignorava o grafo. Agora **todas** as chamadas passam pelo repository real. Não
existe mais nenhum caminho que devolva dados simulados em produção.

## Degradação graciosa

Quando `getDb()` retorna `null` — por exemplo, em testes unitários sem banco, ou
em ambientes onde `DATABASE_URL` não está configurado — os repositories retornam
`[]` (ou `null` para buscas por ID) em vez de lançar exceção.

Isso significa que:

- Services continuam executando sem quebrar.
- O RAG degrada para recuperação sem grafo, sem falhar a consulta.
- Testes de domínio rodam sem necessidade de MySQL.

```ts
export async function searchKnowledgeNodes(orgId: string, filters: NodeFilters) {
  const db = getDb();
  if (!db) return []; // degradação graciosa
  // ... query Drizzle escopada por organization_id
}
```

## Resultado

O Knowledge Graph deixou de ser uma fundação inerte e passou a ser um módulo
operacional: **lê, escreve, valida, atravessa e alimenta o RAG**, com segurança
multi-tenant, replay safety e observabilidade completa.
