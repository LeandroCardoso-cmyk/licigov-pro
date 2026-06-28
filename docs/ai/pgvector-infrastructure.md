# pgvector Infrastructure — Sprint 4.6

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
