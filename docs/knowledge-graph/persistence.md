# Persistence — Repository do Knowledge Graph

## Arquivo

`server/db/knowledgeGraph.ts` é a **única** porta de acesso ao banco para o
módulo Knowledge Graph. Nenhum service fala com Drizzle diretamente — tudo passa
por este repository.

## Padrão `getDb()`

Toda função começa obtendo a instância Drizzle via `getDb()`:

```ts
const db = getDb();
if (!db) return []; // sem banco → degradação graciosa
```

`getDb()` retorna a instância Drizzle configurada ou `null` quando não há
`DATABASE_URL` (por exemplo, em testes unitários). Retornar `null` permite que os
repositories devolvam valores neutros (`[]`, `null`) sem quebrar as camadas
superiores. Ver `operational-wiring.md` para a estratégia de degradação.

## Multi-tenant

**Toda** query é escopada por `organization_id`. Nunca há leitura ou escrita
cross-tenant. O `orgId` vem do contexto tRPC (`tenantProcedure`) e é repassado
explicitamente a cada função do repository.

```ts
where(and(
  eq(knowledgeNodes.organizationId, orgId),
  eq(knowledgeNodes.active, true),
))
```

## Serialização

Colunas de estrutura variável (`aliases`, `metadata`, before/after state do
change log) são armazenadas como **TEXT** e serializadas com `JSON.stringify` na
escrita e `JSON.parse` na leitura. Isso mantém o schema estável enquanto permite
payloads flexíveis por tipo de nó.

## Tabelas

| Tabela | Conteúdo |
|---|---|
| `knowledge_nodes` | Nós (legislação, artigo, cláusula, processo, etc.) |
| `knowledge_edges` | Arestas com `relationship_type` e `deterministicKey` |
| `entity_resolutions` | Deduplicação / resolução de entidades |
| `graph_metrics` | Métricas de observabilidade por operação |
| `graph_versions` | Snapshots de versão para replay |
| `graph_change_log` | Lineage before/after de cada mutação |

## Funções

### Nós

- **`insertKnowledgeNode(node)`** — insere um nó já com ID SHA-256
  determinístico. Serializa `aliases`/`metadata`.
- **`getKnowledgeNodeById(id, orgId)`** — busca por ID **sempre** filtrando por
  `orgId`. Retorna `null` se não existir ou pertencer a outro tenant.
- **`searchKnowledgeNodes(orgId, filters)`** — busca por `node_type`, texto,
  status ativo; suporta paginação SQL.
- **`updateKnowledgeNode(id, orgId, patch)`** — atualização escopada por tenant.
- **`deactivateKnowledgeNode(id, orgId)`** — soft delete (`active = false`),
  preservando lineage.

### Arestas

- **`insertKnowledgeEdge(edge)`** — insere aresta com `deterministicKey` (hash de
  `orgId + source + target + relationshipType`), evitando duplicatas.
- **`getEdgesForNode(nodeId, orgId)`** — retorna arestas ativas conectadas ao nó
  (entrada e saída), base da travessia.
- **`deactivateKnowledgeEdge(id, orgId)`** — soft delete de aresta.

### Ownership

- **`nodeBelongsToOrg(nodeId, orgId)`** — verifica se o nó pertence ao tenant.
  Usado pelos routers antes de criar arestas, garantindo que ninguém conecte nós
  de outra organização.

### Resolução de entidades

- **`insertEntityResolution(resolution)`** — registra que duas entidades foram
  resolvidas como a mesma.
- **`listEntityResolutions(orgId, filters)`** — lista resoluções do tenant.

### Observabilidade e lineage

- **`insertGraphChangeLog(entry)`** — persiste before/after state de cada
  mutação (lineage). Permite reconstruir o grafo a partir do log.
- **`insertGraphVersion(version)`** — registra snapshot de versão.
- **`recordGraphMetricRow(metric)`** — grava métrica de operação em
  `graph_metrics`.
- **`graphStatistics(orgId)`** — agrega contagens (nós, arestas, tipos) para o
  dashboard de observabilidade.

## Regras

- Nunca string interpolation — sempre parâmetros/builders Drizzle.
- Nunca vazar `orgId`: toda função pública recebe e aplica o escopo de tenant.
- Soft delete em vez de delete físico, para preservar rastreabilidade.
- Serialização JSON apenas em colunas TEXT designadas.
