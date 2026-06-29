# Context Assembly — Montagem de Contexto Institucional

## Visão Geral

O Context Assembly é responsável por montar o contexto completo que será utilizado no grounding da resposta. Ele orquestra a recuperação de múltiplas fontes, agrupa semanticamente, comprime para caber no limite de tokens e prioriza evidências.

## Pipeline de Montagem

```
Query → Classificação de Intent → Estratégia de Contexto
  │
  ├── Retrieval de Chunks (semântico + lexical)
  ├── Referências Legais (Lei 14.133/2021, decretos)
  ├── Histórico Municipal (processos anteriores)
  ├── TRs Similares (por similaridade semântica)
  └── Evidências Semânticas (do índice vetorial)
  │
  ▼
Agrupamento Semântico → Compressão → Estimativa de Tokens → Contexto Final
```

## Estratégias de Contexto

| Estratégia | Quando Usar | Fontes Incluídas |
|------------|-------------|------------------|
| full_context | TR generation, document review | Todas |
| selective | Consultas analíticas | Chunks + Legal + TRs |
| minimal | Consultas factuais simples | Chunks mais relevantes |
| legal_focused | Consulta jurídica | Legal + Jurisprudência |
| municipal_focused | Histórico municipal | Histórico + TRs |

## Compressão Contextual

Quando o contexto excede o limite de tokens:
1. Remove chunks com similaridade < threshold
2. Remove evidências com confiança < threshold
3. Reduz histórico municipal aos mais relevantes
4. Mantém referências legais (nunca removidas)

## Estimativa de Tokens

Utiliza aproximação: `palavras / 0.75` (1 token ≈ 0.75 palavras em português).

## Agrupamento Semântico

Chunks são agrupados por `source` para evitar fragmentação de contexto. Cada grupo é apresentado como bloco contínuo no prompt final.
