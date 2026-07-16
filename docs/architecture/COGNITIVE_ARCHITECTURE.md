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

## Ativação cognitiva (RC-4.1)

O **AIExecutionEngine é o ÚNICO ponto de entrada cognitiva do produto**. Ativação concluída:

- Os 5 Business Domains (Processo Licitatório, Contratação Direta, Parecer Jurídico,
  Contratos, Centro de Operações), via `WorkspaceOrchestrator → CopilotReasoning`, chamam
  exclusivamente **`executeCognitiveTask`**.
- **`executeAITask` está aposentado** — sem callers oficiais (só definição no Engine e testes).
- **`invokeLLM`** permanece **apenas em código legado allowlistado**
  (`INVOKE_LLM_LEGACY_ALLOWLIST` em `server/kernel/architecture/legacyBoundaries.ts`) —
  nenhum código novo pode usá-lo.
- **Copilotos** são apenas **especialistas de domínio**: montam contexto, selecionam grounding,
  indicam documentos/legislação e preparam o payload. **Não executam provider nem montam o
  prompt final** — o Prompt Builder tipado do Engine faz a montagem.
- **Mock Provider** ativo nesta fase — valida toda a arquitetura sem APIs externas, sem custo,
  com replay determinístico.

## Componentes da fundação

| Componente | Arquivo | Papel |
|---|---|---|
| **Cognitive Task** | `server/domain/cognitiveTask.ts` | Catálogo oficial de 13 tarefas cognitivas, cada uma com política, grounding declarado, criticidade, domínios permitidos, copiloto e Structured Output. |
| **AI Execution Context** | `server/domain/aiExecutionContext.ts` | Contexto único que acompanha toda execução (tenant, usuário, domínio, processo, task, grounding, provider, tokens, confidence, reasoning, replayHash, correlationId). |
| **Cognitive Response** | `server/domain/cognitiveResponse.ts` | **Contrato universal** de resposta — nenhum copiloto devolve texto solto. Suporta payload estruturado (`structuredData` opcional/nullable) além de `content`. Explainability e validação obrigatórias. |
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

## Contrato cognitivo definitivo (RC-4.0.1)

Após a RC-4.0.1, o contrato entre Business Domains → AIExecutionEngine → Provider Adapter → LLM
é **estável**:

- **CognitiveResponse Genérico / Structured Cognitive Response:** o contrato **não presume
  texto**. Além de `content` (compatibilidade), carrega `structuredData` (opcional, nullable) —
  objeto, lista, matriz, árvore, grafo, comparação, matching, classificação, análise. Versionado
  por `contractVersion` (`cognitive-response/1.1`).
- **Replay Hash Semântico:** `officialReplayHash` representa **exclusivamente a execução lógica**
  (task, context, grounding, policy, prompt, provider, modelo). **Nunca** inclui conteúdo, tempo,
  latência, tokens ou saída do LLM. `response.replayHash === context.replayHash`.
- **Validação Obrigatória:** nenhuma `CognitiveResponse` sai do Engine sem `validateCognitiveResponse`.
  Resposta inválida → `InvalidCognitiveResponse` (falha explícita).
- **Explainability Contract:** toda resposta válida contém obrigatoriamente reasoning, confidence,
  sources, limitations, requiresHumanReview, replayHash e explicabilidade.

## Institutional Reasoning Framework (RC-4.2)

Separação definitiva **Conhecimento → Raciocínio → Resposta**. O AIExecutionEngine
**raciocina institucionalmente antes de responder**: constrói um **InstitutionalReasoningPlan**
(12 etapas declarativas) a partir do grounding, do Knowledge Graph e das **Institutional Rules**
(regras declarativas), e só então produz a Structured Cognitive Response. Toda resposta registra
regras aplicadas, alternativas consideradas e descartadas (com motivo). Mock Provider mantido —
valida o raciocínio, não o texto. Ver [INSTITUTIONAL_REASONING.md](./INSTITUTIONAL_REASONING.md).

## Conhecimento institucional (RC-4.3)

A partir da RC-4.3, o sistema possui um **Institutional Operating Model** — a ontologia
operacional permanente do Departamento de Licitações (papéis, objetos, estados, eventos,
dependências, relacionamentos, regras operacionais). **Declarativa, determinística, sem
conteúdo jurídico.** Reutilizável por Business Domains, Knowledge Graph, AIExecutionEngine,
Copilotos, Document Engine e Reasoning Framework — **somente consulta**, sem alterar o Kernel.
Ver [INSTITUTIONAL_OPERATING_MODEL.md](./INSTITUTIONAL_OPERATING_MODEL.md).

## Monitoramento operacional (RC-4.2.2)

A saúde do Cognitive Kernel é verificável automaticamente (sem executar IA) pelo Monitor
Operacional Institucional: `cognitive_kernel`, `reasoning_framework`, `replay_safety`,
`explainability`, `observability` e `document_engine` compõem o Production Report, com Health
Score determinístico. Ver [PRODUCTION_MONITORING.md](./PRODUCTION_MONITORING.md).

Ver [AI_EXECUTION_ENGINE.md](./AI_EXECUTION_ENGINE.md) e [COGNITIVE_PIPELINE.md](./COGNITIVE_PIPELINE.md).
