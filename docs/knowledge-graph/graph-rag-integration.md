# Graph ↔ RAG Integration

> **Entrega principal da Sprint 4.8.1.** O Knowledge Graph deixa de ser um
> repositório passivo e passa a **enriquecer ativamente o Institutional RAG**,
> adicionando evidências estruturadas, relacionamentos e citações rastreáveis ao
> pipeline de recuperação.

## Pipeline completo

A recuperação institucional passa a intercalar o grafo com a busca vetorial:

```
Consulta
   │
   ▼
Knowledge Graph Lookup ── busca nós relevantes no grafo (por orgId)
   │
   ▼
Entity Resolution ─────── resolve entidades/aliases para nós canônicos
   │
   ▼
Graph Traversal ───────── atravessa arestas para achar contexto relacionado
   │
   ▼
Semantic Retrieval ───── recuperação semântica sobre a base institucional
   │
   ▼
Vector Search ─────────── busca vetorial (embeddings)
   │
   ▼
Hybrid Ranking ────────── combina sinais: vetor + grafo (peso 'graph')
   │
   ▼
Context Assembly ──────── monta o contexto final (evidências + citações)
   │
   ▼
Grounding ─────────────── ancora respostas nas evidências do grafo
   │
   ▼
Provider (LLM) ────────── geração via server/_core/llm.ts (Gemini 2.5 Flash)
   │
   ▼
Validation ────────────── validação Zod da saída
   │
   ▼
Explainability ────────── expõe quais nós/arestas fundamentaram a resposta
```

## `retrieveFromKnowledgeGraph(query, orgId)`

Função em `institutionalRetrievalService.ts`. Ela:

1. **Busca nós relevantes** no grafo para a `query`, sempre escopada por `orgId`
   (via `searchKnowledgeNodes`).
2. **Atravessa arestas** a partir dos nós encontrados (via `getEdgesForNode` e o
   `graphTraversalService`) para descobrir contexto relacionado — por exemplo,
   partindo de uma cláusula, chega ao artigo que a contém e à jurisprudência que
   a referencia.
3. **Retorna evidências** estruturadas que enriquecem quatro dimensões do
   retrieval:

   - **retrieval** — trechos e nós adicionais como candidatos.
   - **evidence** — fatos ancorados no grafo (com tipo e origem).
   - **grounding** — vínculos verificáveis entre resposta e nós.
   - **citations** — referências rastreáveis (Lei, Artigo, Acórdão, etc.).

```ts
async function retrieveFromKnowledgeGraph(
  query: string,
  orgId: string,
): Promise<GraphEvidence> {
  const db = getDb();
  if (!db) return emptyGraphEvidence(); // degradação graciosa

  const seeds = await searchKnowledgeNodes(orgId, { text: query });
  const context = await graphTraversalService.expand(seeds, orgId);
  return toGraphEvidence(seeds, context); // retrieval + evidence + grounding + citations
}
```

## Integração em `retrieveAll()` e `weightedMerge()`

A integração não substitui a busca vetorial — ela **compõe** com ela:

- **`retrieveAll()`** invoca `retrieveFromKnowledgeGraph` em paralelo com a busca
  semântica/vetorial, coletando ambos os conjuntos de evidências.
- **`weightedMerge()`** funde os resultados atribuindo um peso dedicado
  `'graph'` às evidências vindas do Knowledge Graph. O grafo contribui com sinais
  de precedência jurídica (ancoragem em Lei/Artigo/Acórdão) que a busca vetorial
  sozinha não captura.

```ts
const merged = weightedMerge([
  { source: 'vector', weight: weights.vector, items: vectorHits },
  { source: 'graph',  weight: weights.graph,  items: graphEvidence.retrieval },
]);
```

## Por que o grafo melhora o RAG

- **Precisão jurídica** — evidências ancoradas na cadeia
  Lei → Artigo → ... → Contrato, não só similaridade textual.
- **Explicabilidade** — cada citação aponta para um nó real e rastreável.
- **Contexto relacionado** — a travessia traz fundamentos que não apareceriam por
  busca vetorial isolada (ex.: acórdão que interpreta o artigo citado).

## Degradação graciosa sem DB

Se `getDb()` retornar `null`, `retrieveFromKnowledgeGraph` devolve evidências
vazias e o pipeline degrada para RAG puramente vetorial — sem falhar a consulta.
O peso `'graph'` simplesmente não contribui, e o `weightedMerge` opera apenas com
os sinais disponíveis.
