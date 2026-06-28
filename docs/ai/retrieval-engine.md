# Retrieval Engine — Sprint 4.6

## Strategies
- **vector_similarity**: Cosine similarity pura
- **bm25_hybrid**: Combinação de vetorial + BM25 (60/40)
- **weighted_retrieval**: Pesos customizáveis (50/30/20)
- **contextual_expansion**: Expansão contextual com chunks adjacentes

## Pipeline
1. Query normalization
2. Query embedding generation
3. Vector similarity search
4. BM25 scoring (se híbrido)
5. Score fusion
6. Optional reranking
7. Evidence generation
8. Explainability

## Explainability
Cada resultado inclui: similarity score, BM25 score, rerank score, final score, ranking reason, evidence type.
