# Explainability Model — Sprint 4.2

## Visão geral

Modelo de explicabilidade para todas as decisões de IA do LiciGov Pro.

## Componentes

- `aiReasoning.ts` — `buildExplainabilityTree`, `formatReasoningForHuman`
- `contextPolicies.ts` — auditTrail append-only em cada aplicação de política
- `contextRankingService.ts` — `scoreBreakdown` por dimensão em cada RankedFragment
- `groundingExpansionService.ts` — `provenanceGraph` e `citationChain`

## Árvore de explicabilidade

`buildExplainabilityTree(trace)` retorna estrutura hierárquica:
```json
{
  "traceId": "...",
  "sessionId": "...",
  "organizationId": 9500,
  "stages": [...],
  "conclusion": "...",
  "overallConfidence": 0.82,
  "contradictions": [],
  "ambiguities": []
}
```

## Auditoria de políticas

Cada aplicação de política gera `PolicyApplication` com:
- `auditTrail` — append-only array de strings descrevendo cada ação
- `wasRedacted` / `wasMasked` — flags explícitas
- `originalSensitivity` / `resultSensitivity` — antes e depois

## Justificativa jurídica

Toda decisão de IA referencia `legalBasis` (ex: "Lei 14133/2021 Art. 6") quando aplicável, garantindo rastreabilidade para auditoria forense e conformidade com Lei 14133/2021.
