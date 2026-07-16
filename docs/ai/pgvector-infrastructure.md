# pgvector Infrastructure — Sprint 4.6

> **RC-3.5 — Banco oficial:** o LiciGov Pro usa **MySQL (Railway)** como banco oficial e único.
> Os embeddings são armazenados em colunas JSON no MySQL. A seção "Future Migration Path"
> abaixo (PostgreSQL + pgvector) é apenas uma **hipótese de evolução futura NÃO adotada** —
> não descreve a infraestrutura atual.

## Current State
- Storage: MySQL (JSON arrays for vectors)
- Similarity: Cosine computed in JavaScript
- Indexing: In-memory VectorIndex

## Future Migration Path
1. Add PostgreSQL with pgvector extension
2. Implement PgVectorStore adapter (VectorStore interface)
3. Enable HNSW or IVFFlat indexes
4. Migrate embeddings to native vector columns

## Abstraction Layer
VectorStore interface:
- search(queryVector, topK): SimilarityResult[]
- append(embeddings): void
- rebuild(embeddings): void
- detectOrphans(validIds): string[]

## ANN Preparation
Architecture supports future:
- HNSW (Hierarchical Navigable Small World)
- IVFFlat (Inverted File with Flat Quantization)
- Product Quantization
