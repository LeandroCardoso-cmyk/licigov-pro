# AIExecutionEngine — O Cérebro Institucional (RC-4.0)

> Componente permanente do Cognitive Kernel (`ai_execution_engine`). A partir da RC-4.0,
> é a **única porta cognitiva**: os Business Domains solicitam Cognitive Tasks; o engine
> resolve política, grounding, copiloto, provider e produz uma Cognitive Response.

## Entradas oficiais

- **`executeCognitiveTask(input)`** — o pipeline cognitivo (fase RC-4.0). Retorna
  `{ response, context, observability, validation, stages }`.
- **`executeAITask(input)`** — pipeline de inferência de baixo nível (RC-3.5), mantido por
  compatibilidade. Roteia por AIExecutionPolicy + Provider Adapter.

## `executeCognitiveTask` — contrato

```ts
executeCognitiveTask({
  task,            // CognitiveTaskId (uma das 13)
  tenantId, userId, correlationId,
  query,           // objetivo estruturado (nunca prompt cru)
  businessDomain?, workspaceId?, processId?, stage?,
  groundingBlock?, documentRefs?, lawRefs?,
}) => { response: CognitiveResponse, context: AIExecutionContext, observability, validation, stages }
```

- **Autorização cognitiva:** se `businessDomain` for informado e não estiver em
  `task.allowedBusinessDomains`, a execução é negada.
- **Decisão de provider:** vem exclusivamente da `policy` da tarefa (preferido → fallback →
  mock), via Provider Adapter. Nunca no domínio.
- **Determinístico e replay-safe (RC-4.0.1):** `officialReplayHash` cobre **apenas a
  execução lógica** (task, context, grounding, policy, prompt, provider, modelo) — **nunca**
  conteúdo, tempo, latência, tokens ou saída do LLM. `response.replayHash === context.replayHash`.
- **Validação obrigatória (RC-4.0.1):** o Engine SEMPRE valida a resposta; inválida →
  `InvalidCognitiveResponse`. Nenhuma resposta inválida sai do Engine.
- **Structured Cognitive Response (RC-4.0.1):** o Engine pode produzir texto **ou** payload
  estruturado (`responseType` + `structuredData`) — o contrato não presume texto.

## Decisões delegadas à AIExecutionPolicy

O engine **nunca** decide diretamente provider, modelo, grounding, Knowledge Graph,
temperature, context window ou explainability — tudo vem da política da Cognitive Task.

## Observabilidade

Toda execução gera `CognitiveObservability` (execução, reasoning, provider, grounding, RAG,
KG, latência, tokens, validação de Structured Output), recuperável por `correlationId`.

## Restrições da fase (RC-4.0)

- **Não** conecta Gemini/Claude (usa o Provider Adapter; sem chave → mock determinístico).
- **Não** cria prompts jurídicos (builders são estruturais).
- **Não** gera documentos.
- **Não** altera Business Domains nem UX.

Ver [COGNITIVE_PIPELINE.md](./COGNITIVE_PIPELINE.md).
