# Institutional Reasoning Framework (RC-4.2)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-4.2 separa definitivamente **Conhecimento → Raciocínio → Resposta**. O
> AIExecutionEngine passa a **raciocinar institucionalmente antes de produzir qualquer
> resposta**. IA supervisionada, servidor sempre decide, recomendações auditáveis,
> replay determinístico. Mock Provider mantido (valida o raciocínio, não o texto).

## Separação

```
Conhecimento (Grounding + KG + RAG + Institutional Rules)
      ↓
Raciocínio (InstitutionalReasoningPlan — 12 etapas declarativas)
      ↓
Resposta (Structured Cognitive Response + Explainability)
```

## Componentes

| Componente | Arquivo | Papel |
|---|---|---|
| **Institutional Reasoning Steps** | `server/domain/institutionalReasoning.ts` | As 12 etapas oficiais e **declarativas** do raciocínio. |
| **InstitutionalReasoningPlan** | `server/domain/institutionalReasoning.ts` | Plano de raciocínio (objetivo, contexto, etapas, leis, documentos, restrições, riscos, alternativas, regras). **Nenhuma decisão.** |
| **Institutional Rules** | `server/domain/institutionalRules.ts` | Repositório oficial de regras **declarativas** (estrutura, não conteúdo jurídico). |

## As 12 etapas de raciocínio (declarativas)

1. Entender a solicitação · 2. Identificar o Business Domain · 3. Identificar a etapa do
processo · 4. Identificar legislação relevante · 5. Identificar documentos necessários ·
6. Identificar riscos · 7. Identificar inconsistências · 8. Levantar alternativas possíveis ·
9. Construir recomendação · 10. Construir justificativa · 11. Gerar Explainability ·
12. Gerar Structured Response.

## Institutional Rules (declarativas)

Cada regra tem `id`, `statement` (enunciado curto), `category` e escopo
(`appliesToDomains`/`appliesToTasks`). Exemplos: "ETP pode ser dispensado", "TR obrigatório",
"Parecer obrigatório", "Aditivo exige justificativa", "Dispensa exige justificativa",
"Ratificação exige registro". **Sem conteúdo jurídico — apenas estrutura.**

## Reasoning Pipeline (AIExecutionEngine)

```
Task → Policy → Grounding → Knowledge Graph → RAG → Institutional Rules →
Reasoning Plan → Copilot → Prompt Builder → Provider (Mock) → LLM →
Structured Response → Reasoning → Explainability → Validation → Result (+ Observability)
```

O `InstitutionalReasoningPlan` é construído **antes** do Prompt Builder e do Provider — o
Engine raciocina antes de responder. O plano acompanha a `CognitiveExecution` (`reasoningPlan`).

## Explainability expandida (Part 5 — nada implícito)

Toda resposta registra: `rulesApplied` (regras usadas), `alternativesConsidered`,
`discardedAlternatives` (com **motivo**), além de documentos/leis usados, confiança e
limitações. `whyAnswered` referencia o `reasoningPlan.id`.

## Observabilidade (Part 8 — recuperável por correlationId)

Registra `reasoningPlanId`, `reasoningPlanHash`, `appliedRules`, `alternativePaths`,
`discardedPaths`, `knowledgeSources`, `groundingUsed` — além dos campos do contrato.

## Replay Safety

O plano é **reproduzível**: `buildReasoningPlan` é determinístico (replayHash sobre insumos
lógicos — task, objetivo, domínio, etapa, leis, regras). Mesmos insumos → mesmo plano.
