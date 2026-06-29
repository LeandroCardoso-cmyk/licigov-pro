# Vector Architecture — Sprint 4.6

## Overview
Infraestrutura cognitiva persistente para retrieval semântico, embeddings vetoriais e memória institucional.

## Components
- **SemanticChunk**: Chunks com provenance, lineage e hash determinístico
- **VectorEmbedding**: Embeddings com versionamento e replay snapshot
- **RetrievalSession**: Sessões de retrieval com tracing completo
- **RetrievalEvidence**: Evidências com ranking e justificativas
- **SemanticCorpus**: Corpus organizacional com indexação
- **VectorIndex**: Índice vetorial in-memory com cosine similarity

## Vector Storage
Atualmente: MySQL (JSON) + cosine similarity em JavaScript.
Preparado para migração futura: pgvector, Qdrant, Weaviate, Pinecone.

## Multi-tenancy
Toda operação vetorial é isolada por organizationId.
