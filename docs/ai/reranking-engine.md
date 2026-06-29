# Reranking Engine — Sprint 4.6

## Strategies
- **semantic**: Reranking por relevância semântica com boost contextual
- **contextual**: Reranking por sobreposição de tokens com a query
- **legal_priority**: Boost para conteúdo jurídico (Art., Lei, §)
- **workflow_aware**: Reranking considerando contexto do workflow

## Scoring
Score final = score original + boost de estratégia (max 0.2 boost).
