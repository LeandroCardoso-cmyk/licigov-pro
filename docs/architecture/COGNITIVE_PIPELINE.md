# Cognitive Pipeline — Pipeline Oficial (RC-4.0)

> O pipeline cognitivo do AIExecutionEngine (`executeCognitiveTask`). Todo passo é
> **observável**. Determinístico, multi-tenant, replay-safe.

## Fluxo oficial

```
AIExecutionEngine
   ↓
Task                  (Cognitive Task + autorização de domínio)
   ↓
Execution Policy      (provider, modelo, temperature, contexto, custo)
   ↓
Grounding             (declarado pela tarefa)
   ↓
Knowledge Graph       (declarado pela tarefa)
   ↓
RAG                   (declarado pela tarefa)
   ↓
Copilot               (copiloto recomendado)
   ↓
Provider Adapter      (seleção via política: preferido → fallback → mock)
   ↓
LLM                   (inferência; latência medida)
   ↓
Structured Output     (coerção + validação — nunca texto solto)
   ↓
Reasoning             (traço de raciocínio)
   ↓
Explainability        (obrigatória: por quê, docs, leis, descartes, confiança, limitações)
   ↓
Resultado             (Cognitive Response + AI Execution Context + Observability)
```

## As 13 etapas (observáveis)

Cada etapa é registrada em `stages[]` com `status` (`applied`/`skipped`) e `detail`:

`task` → `policy` → `grounding` → `knowledge_graph` → `rag` → `copilot` → `prompt` →
`provider` → `llm` → `structured_output` → `reasoning` → `explainability` → `result`.

## Saídas

- **Cognitive Response** — conteúdo, reasoning, confidence, fontes, leis, jurisprudência,
  documentos, recomendações, alternativas, riscos, limitações, tokens, latência, provider,
  modelo, replayHash, `requiresHumanReview: true`.
- **AI Execution Context** — o contexto único da execução (quem pediu, o que usou, resultado).
- **Cognitive Observability** — logs estruturados + validação de Structured Output.

## Grounding declarado (nada implícito)

Cada Cognitive Task declara `usesGrounding`, `usesRAG`, `usesKnowledgeGraph`,
`usesLegislation`, `usesDocuments`, `usesInstitutionalContext`. O pipeline aplica/pula
cada etapa conforme a declaração — nunca por inferência implícita.

## Prompt Builders

O prompt é montado por um **builder tipado** da tarefa (`getPromptBuilder`). Nenhum serviço
concatena prompt manualmente. Na fase RC-4.0 os builders são **estruturais** (papel,
objetivo, grounding, formato de saída) — sem conteúdo jurídico.

Ver [COGNITIVE_ARCHITECTURE.md](./COGNITIVE_ARCHITECTURE.md) e [AI_EXECUTION_ENGINE.md](./AI_EXECUTION_ENGINE.md).
