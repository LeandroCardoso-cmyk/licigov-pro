# Institutional Bootstrap Framework (RC-X.2)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO implementa regra de negócio.** Não implementa login, JWT, sessão, banco,
> React, sidebar, home, Business Domains, Lei 14.133, IA, Providers, RAG nem bootstrap visual.
> Cria apenas a **arquitetura permanente** que inicializa a plataforma institucional. Declarativa,
> determinística, multi-tenant, replay-safe, explicável, observável.

## O que é

O sistema tinha três pilares (Cognitive Architecture, Institutional Experience Framework e
Business Domains), mas **nenhuma camada que os orquestrasse na inicialização**. O **Institutional
Bootstrap Framework** (`server/domain/bootstrap/`) cria essa camada: um **Bootstrap Kernel** que
prepara todo o ambiente institucional de forma determinística, sem executar regra de negócio.

```
Authentication → Institution Context → Corpus → Package → Capability → Workspace →
Navigation → Home → Copilot → Business → Ready
```

## Componentes

| Parte | Componente | Arquivo | Papel |
|---|---|---|---|
| 1 | **BootstrapKernel** | `bootstrapKernel.ts` | Coordena toda a inicialização (`runBootstrap`): monta pipeline, resolve dependências, executa etapas na ordem determinística, agrega saúde/estado. |
| 2 | **BootstrapPipeline** | `bootstrapPipeline.ts` | Pipeline declarativo — etapas derivadas do registro e ordenadas pelo grafo de dependências. |
| 3 | **BootstrapStage / Step / Result** | `bootstrapStage.ts` | Etapa (id, name, description, dependencies, status, duration, metadata), execução e resultado global. |
| 4 | **BootstrapDependencyGraph** | `bootstrapDependencyGraph.ts` | Ordem determinística (Kahn com desempate por id), dependências explícitas, **sem ciclos**, replay-safe. |
| 5 | **PlatformState** | `platformState.ts` | BOOTING, INITIALIZING, READY, FAILED, RELOADING, SUSPENDED + transições válidas. |
| 6 | **Context Reload** | `contextReload.ts` | Arquitetura (sem execução) para trocas de Tenant/Município/Licença/Capabilities/Workspaces/Corpora/Branding — planeja quais etapas reexecutar. |
| 7 | **BootstrapRegistry** | `bootstrapRegistry.ts` | Cada subsistema registra id, dependencies, initializer, healthCheck, shutdown, metadata (append-only). |
| 8 | **BootstrapHealth** | `bootstrapHealth.ts` | READY, DEGRADED, FAILED, INITIALIZING, UNKNOWN + agregação (pior prevalece). |
| 10 | **Explainability** | `bootstrapExplainability.ts` | Toda inicialização explica: o que carregou, por que, qual dependência exigiu, tempo, ordem e resultado. |
| — | **Sample** | `bootstrapSample.ts` | Registro com os subsistemas institucionais padrão (demonstra a extensibilidade da Part 11). |
| 9 | **Observabilidade** | `server/services/bootstrap/bootstrapObservabilityService.ts` | Eventos (bootstrapStarted/Finished/Failed, stageStarted/Finished, dependencyResolved, subsystemLoaded) por **correlationId**. |

## Execução (Bootstrap Kernel)

`runBootstrap` executa as etapas na ordem topológica. Uma etapa é **pulada** se alguma
dependência não concluiu; o estado final é **READY** (todas concluídas) ou **FAILED** (alguma
falhou). O `replayHash` é determinístico sobre a execução lógica (etapa, status, saúde,
dependências) — **exclui duração/tempo**, garantindo replay-safety.

## Extensibilidade (Part 11)

Todo novo módulo registra apenas **BootstrapStage + Dependencies + Initializer + HealthCheck** —
**nunca** altera o BootstrapKernel. O pipeline e a ordem são recalculados automaticamente.

## Context Reload (Part 6)

Cada gatilho de reload mapeia para uma etapa raiz; o plano inclui a raiz **e todos os dependentes
transitivos**, na ordem do pipeline. Ex.: `capabilities_update` recarrega `capability_resolution`
→ `workspace_resolution` → `navigation_resolution` → `home_resolution` → `business_resolution` →
`ready`. `tenant_switch` recarrega tudo. **Somente arquitetura — nada é executado.**

## Garantias

- **Determinismo/Replay Safety:** ordem topológica estável; `replayHash` sem tempo; mesma entrada
  → mesmo resultado lógico.
- **Multi-tenant:** `tenantId` percorre toda a execução; tenants distintos → replayHash distinto.
- **Explainability/Observabilidade/Auditabilidade:** toda etapa se explica e é observável por
  correlationId.
- **Baixo acoplamento:** camada declarativa; não altera Kernel Cognitivo, Experience Framework,
  Business Domains, Authentication nem AIExecutionEngine. Sem regra de negócio, sem IA.

## Garantias por teste (`rcx2-institutional-bootstrap-framework.test.ts`, ORG 13000)

Platform State (transições), Health (agregação), Dependency Graph (ordem determinística + ciclo),
Registry (append-only + initializers padrão), Pipeline (ordem canônica), Kernel (READY + falha
propaga skip + multi-tenant/replay), Context Reload (plano determinístico raiz+dependentes),
Explainability, observabilidade por correlationId, replay safety. **Zero regressões.**

## Visão de longo prazo

Após esta RC, toda inicialização da plataforma ocorre pelo Bootstrap. A plataforma inicializa
qualquer combinação de Tenant / Licença / Corpora / Capabilities / Workspaces / Business Domains
de forma determinística, e cada novo módulo registra apenas Stage/Dependencies/Initializer/
HealthCheck.
