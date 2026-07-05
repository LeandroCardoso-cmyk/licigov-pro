# Arquitetura do RAG Institucional

## Visão Geral

O RAG Institucional do LiciGov Pro é o motor responsável por garantir que toda resposta gerada pelo sistema seja fundamentada em conhecimento institucional recuperado. Nenhum prompt é enviado ao provider de IA sem contexto institucional.

## Princípio Central

```
Pergunta → Context Assembly → Retrieval → Evidence → Reranking → Grounding → LLM → Explainability
```

Toda inferência obrigatoriamente passa por esta cadeia. É proibido enviar prompts crus ao provider.

## Pipeline de 6 Estágios

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  Retrieval   │───>│  Evidence     │───>│   Context    │
│  (multi-src) │    │  Selection   │    │   Assembly   │
└─────────────┘    └──────────────┘    └──────────────┘
                                              │
┌─────────────┐    ┌──────────────┐    ┌──────┴───────┐
│  Validation  │<───│  Citation    │<───│  Grounding   │
│  + Approval  │    │  Engine      │    │  + LLM Call  │
└─────────────┘    └──────────────┘    └──────────────┘
```

## Propriedades Garantidas

- **Grounded**: toda resposta baseada em evidências recuperadas
- **Explainable**: cada decisão possui reasoning trace
- **Replay-safe**: mesma entrada → mesma saída (determinístico)
- **Auditable**: correlation IDs em toda a cadeia
- **Multi-tenant**: isolamento por organizationId
- **Institutional**: conhecimento da própria organização

## Fontes de Conhecimento

| Fonte | Tipo | Status |
|-------|------|--------|
| Termos de Referência | tr | Ativo |
| DFDs | dfd | Ativo |
| ETPs | etp | Ativo |
| Lei 14.133/2021 | legislation | Ativo |
| Jurisprudência | jurisprudence | Ativo |
| Templates Municipais | template | Ativo |
| CATMAT/CATSER | catalog | Planejado |

## Integração com Infraestrutura Existente

O RAG Institucional utiliza:
- **Vector Infrastructure** (Sprint 4.6) para embeddings e busca semântica
- **Semantic Retrieval** para recuperação de chunks
- **Reranking Engine** para priorização de evidências
- **AI Execution Engine** para chamadas ao provider
- **Provider Governance** para controle de custos e aprovações

## Controle de Qualidade

Cada resposta recebe:
- Score de confiança consolidado (5 dimensões)
- Avaliação de risco de alucinação
- Detecção de afirmações sem suporte
- Detecção de contradições
- Determinação automática de necessidade de aprovação humana
