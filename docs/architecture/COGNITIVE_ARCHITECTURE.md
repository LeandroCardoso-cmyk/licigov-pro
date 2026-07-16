# Cognitive Architecture — Fundação Cognitiva (RC-4.0)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A infraestrutura do Cognitive Kernel está encerrada. A partir da RC-4.0 começa a fase
> **cognitiva**: o AIExecutionEngine passa a ser o **cérebro institucional** do LiciGov Pro.
> Toda IA permanece **supervisionada, explicável, auditável, reproduzível e rejeitável**
> pelo servidor. Esta fase constrói a **fundação** — não conecta LLM, não gera documentos,
> não cria prompts jurídicos.

## Princípio

Os Business Domains **não conversam mais** com componentes cognitivos (RAG, Knowledge
Graph, providers, copilotos). Eles apenas **solicitam uma Cognitive Task** ao
AIExecutionEngine. Toda cognição passa pelo engine.

```
Business Domain → (Cognitive Task) → AIExecutionEngine → … → Cognitive Response
```

## Componentes da fundação

| Componente | Arquivo | Papel |
|---|---|---|
| **Cognitive Task** | `server/domain/cognitiveTask.ts` | Catálogo oficial de 13 tarefas cognitivas, cada uma com política, grounding declarado, criticidade, domínios permitidos, copiloto e Structured Output. |
| **AI Execution Context** | `server/domain/aiExecutionContext.ts` | Contexto único que acompanha toda execução (tenant, usuário, domínio, processo, task, grounding, provider, tokens, confidence, reasoning, replayHash, correlationId). |
| **Cognitive Response** | `server/domain/cognitiveResponse.ts` | Modelo único de resposta — nenhum copiloto devolve texto solto. Explainability obrigatória. |
| **Prompt Builders** | `server/services/cognitive/promptBuilders.ts` | Um builder tipado por tarefa. Nenhum serviço concatena prompt manualmente. |
| **Cognitive Observability** | `server/services/cognitive/cognitiveObservabilityService.ts` | Logs de execução/reasoning/provider/grounding/RAG/KG + latência/tokens + validação de Structured Output. Infraestrutura, não dashboard. |
| **AIExecutionEngine** | `server/services/aiExecutionEngine.ts` | `executeCognitiveTask(...)` — o pipeline cognitivo oficial. |

## As 13 Cognitive Tasks

`GENERATE_DOCUMENT`, `REVIEW_DOCUMENT`, `LEGAL_ANALYSIS`, `LEGAL_REASONING`,
`PROCUREMENT_REASONING`, `DIRECT_PROCUREMENT_REASONING`, `CONTRACT_REASONING`,
`ITEM_REASONING`, `CATMAT_MATCHING`, `RISK_ANALYSIS`, `COMPLIANCE_CHECK`,
`WORKFLOW_RECOMMENDATION`, `DOCUMENT_IMPROVEMENT`.

Cada tarefa declara: `id`, `name`, `description`, `context`, `criticality`,
`allowedBusinessDomains`, `recommendedCopilot`, `grounding` (usa grounding/RAG/KG/leis/
documentos/contexto institucional — **nada implícito**), `requiresExplainability` (sempre
`true`), `structuredOutput` e a `policy` (provider preferido/fallback, modelo, temperature,
context window, custo).

## Governança (Product North Star)

- **Supervisionada:** toda `CognitiveResponse` carrega `requiresHumanReview: true`.
- **Explicável:** `explainability` obrigatória (por que respondeu, documentos/leis usados,
  recomendações descartadas, confiança, limitações).
- **Auditável/Observável:** toda execução gera observabilidade estruturada.
- **Reproduzível:** `replayHash` determinístico (insumos estáveis, sem tempo/tokens).
- **Rejeitável:** a saída é sempre revisada por servidor competente.

Ver [AI_EXECUTION_ENGINE.md](./AI_EXECUTION_ENGINE.md) e [COGNITIVE_PIPELINE.md](./COGNITIVE_PIPELINE.md).
