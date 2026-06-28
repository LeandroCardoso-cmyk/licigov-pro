# Semantic Governance — Sprint 4.6

## Policies
- maxChunksPerCorpus: Limite de chunks por corpus (default: 10000)
- maxEmbeddingsPerDay: Limite diário de embeddings (default: 5000)
- maxRetrievalsPerDay: Limite diário de retrievals (default: 10000)
- maxTokenBudgetPerDay: Orçamento diário de tokens (default: 500000)
- retentionDays: Período de retenção (default: 365)
- requireApprovalForReindex: Reindex requer aprovação humana

## Enforcement
Todas as operações são validadas contra políticas ativas antes da execução.

## Quota Management
Quotas são verificadas em tempo real e retornam remaining budget.
