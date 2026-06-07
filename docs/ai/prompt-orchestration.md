# Prompt Orchestration — Sprint 4.2

## Visão geral

Sistema de orquestração de chains de prompts para execução determinística e controlada de pipelines de IA.

## Componentes

- `promptOrchestration.ts` — tipos PromptStage, PromptChain, PromptExecutionPlan
- `promptOrchestratorService.ts` — execução de chains com mock determinístico
- `promptTemplateService.ts` — gestão de templates com versionamento semântico

## Topological Sort (Kahn's Algorithm)

O `buildExecutionPlan` usa Kahn's algorithm para:
1. Calcular in-degree de cada stage
2. Iniciar com stages sem dependências
3. Propagar completude removendo edges conforme stages são processados
4. Detectar stages paralelizáveis (mesmo nível de dependência)

## Versionamento de Templates

- `1.0.0` → `1.1.0` — `versionTemplate` (minor bump)
- `1.1.0` → `2.0.0` — `rollbackTemplate` (major bump)
- Lineage imutável: append-only array de IDs anteriores

## Replay Safety

`replayKey = sha256(chainId + sessionId + sorted variable keys)` — reproduzível a qualquer momento.
