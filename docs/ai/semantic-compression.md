# Semantic Compression — Sprint 4.2

## Visão geral

Compressão semântica de fragments de contexto para respeitar limites de tokens.

## Pipeline de compressão

1. **Deduplicação** — remove duplicatas por `replayKey` idêntico
2. **Overlap semântico** — Jaccard > 0.7 → remove o de menor relevância
3. **Stale removal** — remove fragments com `staleness > 0.8` (exceto critical e preservePriority)
4. **Pruning por prioridade** — remove background, depois low... até atingir `targetTokens`
5. **Preservação** — fragments em `preservePriority` nunca são removidos

## Jaccard similarity

```
J(A, B) = |A ∩ B| / |A ∪ B|
```

Tokenização: `content.toLowerCase().split(/\s+/)`.

## ReplayKey

`sha256(sorted fragment replayKeys + targetTokens)` — determinístico por configuração.
