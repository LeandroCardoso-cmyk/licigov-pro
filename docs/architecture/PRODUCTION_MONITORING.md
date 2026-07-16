# Production Monitoring (RC-4.2.2)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-4.2.2 cria o **Monitor Operacional Institucional**: o sistema verifica automaticamente
> sua própria saúde operacional e responde "O ambiente está apto para operar?" — **sem executar
> IA, sem chamar Providers, sem gerar documentos, sem acessar Business Domains, sem expor secrets.**

## Production Health Engine

`server/services/productionMonitoringService.ts` — consolidador central de diagnósticos.
**Somente leitura**, determinístico, reutilizável por interfaces administrativas (não cria UI).

`runProductionHealthCheck()` → **Production Report** com módulos, cada um contendo
`status` (OK/WARNING/CRITICAL), `message`, `detail` e `recommendation`.

## Módulos avaliados

| Módulo | Verifica |
|---|---|
| `database` | DATABASE_URL, conectividade (best-effort), migration journal, última migration. |
| `storage` | Storage Service configurado, Storage Policy, capacidades (put/get/delete/exists/signedUrl/healthCheck). **Nunca grava.** |
| `provider_layer` | Provider Adapter, providers implementados/placeholders, seleção e fallback. **Sem conectar providers.** |
| `cognitive_kernel` | AIExecutionEngine + Cognitive Tasks (13) + Prompt Builders (13). |
| `institutional_rules` | Regras declarativas presentes. |
| `reasoning_framework` | 12 etapas de raciocínio. |
| `replay_safety` | Plano reproduzível (mesmos insumos → mesmo replayHash). |
| `explainability` | Validação obrigatória no Engine. |
| `document_engine` | Pipeline oficial + Lifecycle. |
| `observability` | Memória + persistência (recuperável por correlationId). |
| `knowledge_graph` / `rag` | Disponibilidade (degrada sem DB). |
| `environment` | Variáveis obrigatórias/opcionais (nomes; **nunca valores**). |

## Health Score (determinístico)

`computeHealthScore(modules)` = `100 − 10×WARNING − 30×CRITICAL` (clamp `[0,100]`). Bandas:

| Score | Banda |
|---|---|
| 100 | Sistema totalmente operacional |
| 90 | Pronto para produção |
| 70 | Pode operar com observações |
| 50 | Necessita intervenção |
| 0 | Sistema indisponível |

O score deriva **apenas dos status** — totalmente determinístico (não depende de latência/tempo).

## Endpoint institucional

`systemRouter.productionHealth` (tRPC, `/system/health`) — **somente leitura**. Retorna o
**sumário público** (`toPublicSummary`): `overallStatus`, `healthScore`, `scoreBand`, `warnings`,
`criticalIssues`, `infrastructure` (status por módulo). **Nunca** retorna secrets nem valores de
variáveis de ambiente.

## Observabilidade do Health Check

Cada execução gera um `HealthCheckRun` (`correlationId`, `timestamp`, `durationMs`,
`overallStatus`, `healthScore`, `modulesEvaluated`, `warnings`, `criticalIssues`). Retenção
simples em memória (**últimos 50**), recuperável via `getHealthCheckRuns()` e limpável via
`clearHealthCheckRuns()`. **Não polui o banco.**

## Garantias por teste (`rc422-production-monitoring.test.ts`, ORG 12100)

Health Score e bandas; Production Report com todos os módulos; determinismo (duas execuções →
mesmo score/status); Cognitive Health estrutural sem executar IA; endpoint sem secrets (sentinela);
observabilidade + retenção. **Zero regressões.** Ver [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).
