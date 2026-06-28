# Chunk Lineage — Sprint 4.6

## Chunking Strategies
- **paragraph_chunking**: Split por parágrafos duplos
- **semantic_chunking**: Split semântico (parágrafos com contexto)
- **sliding_window**: Janela deslizante com overlap configurável
- **hierarchical_chunking**: Agrupamento hierárquico de parágrafos
- **legal_clause_chunking**: Split por Art., §, Inciso, Alínea

## Provenance
Cada chunk mantém: documentId, sourceType, sourceSnapshotId, chunkIndex, chunkHash (SHA-256), strategy.

## Deduplication
Chunks com mesmo chunkHash + organizationId são considerados duplicados.
