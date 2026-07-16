# Production Readiness (RC-4.2.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-4.2.1 resolve as **pendências operacionais** identificadas na Architecture Review 2.0,
> **sem alterar o Cognitive Kernel** nem os Business Domains. Após esta RC, encerra-se a fase
> de infraestrutura. Nenhum Provider real conectado (Mock Provider mantido).

## 1. Observabilidade Persistente

A observabilidade cognitiva deixou de depender **apenas** de `Map` em memória.

- **Persistência:** tabela `cognitive_observability` (migration `0283`), repositório
  `server/db/cognitiveObservability.ts` (padrão `getDb()` — degrada sem DB).
- **Facade (repository):** `server/services/cognitive/observabilityRepository.ts` separa
  Infraestrutura → Persistência → Consulta → Recuperação. Sem regra de negócio.
- **Serviço:** `recordCognitiveObservability` grava em memória **e** persiste (fire-and-forget
  seguro). `recoverCognitiveObservability(correlationId)` recupera de memória e, se ausente
  (restart / outra instância), do repositório persistente.
- **Campos:** correlationId, replayHash, reasoningPlanId/Hash, provider, latência, tokens,
  structuredOutputValid, executionStatus + snapshot completo (JSON). Determinístico (id via sha256).

## 2. Storage Readiness

`storageReadiness()` (em `server/storage.ts`) — diagnóstico **somente-leitura** (não acessa a AWS):
`configured`, `fallbackAllowed`, `bucketConfigured`, `regionConfigured`, `credentialsConfigured`,
`publicUrlConfigured`. Comportamento consistente: dev/testes permitem fallback; produção/staging
exigem storage (`assertStorageUsable` falha explicitamente). Document Engine **não** alterado.

## 3. Provider Readiness

`providerReadiness()` (em `operationalHealthService.ts`) valida o Provider Adapter **sem conectar
providers**: `gemini`/`mock` implementados, `claude`/`openai` placeholders, seleção e fallback
resolvem (para Mock nesta fase). Preparado para receber Gemini/Claude/OpenAI no futuro.

## 4. Operational Health

`operationalHealth()` — verificação institucional (somente-leitura, sem providers reais) dos
componentes: **database, storage_service, provider_adapter, document_engine,
official_document_lifecycle, cognitive_observability, cognitive_kernel, knowledge_graph, rag**.

## 5. Environment Validation (sem fallback silencioso)

`server/config/env.ts` — `validateRequiredEnv()` agora exige, **em produção**,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_REGION`, `AWS_S3_BUCKET` (além de
`DATABASE_URL` e `JWT_SECRET` sempre). `GEMINI_API_KEY` é **opcional** nesta RC (Provider real
não conectado). Ausência de obrigatória → **erro explícito** (nunca fallback silencioso).
`environmentDiagnostic()` expõe o diagnóstico sem lançar.

## 6. Production Configuration Report

`productionReadinessReport()` — relatório institucional agregando ambiente, storage, provider,
health e kernel. **Somente diagnóstico** — nunca altera estado.

## 7. Legacy classificado (sem remoção)

`server/kernel/architecture/legacyBoundaries.ts` — `BOUNDARY_CLASSIFICATIONS` classifica cada
item das allowlists como **mantém**, **migração futura** ou **remoção futura**. `DOCUMENT_RENDERERS`
registrado. Ver [LEGACY_INVENTORY.md](./LEGACY_INVENTORY.md).

## Garantias por teste (`rc421-production-readiness.test.ts`, ORG 12000)

Observabilidade recuperável por correlationId; persistência degrada sem DB (nunca lança);
storage validado + signed URL falha explícita sem config; Provider Adapter íntegro; Health Check
completo (9 componentes); AWS obrigatória só em produção; `validateRequiredEnv` falha sem
JWT_SECRET; report de produção agrega tudo. **Kernel inalterado.**

---

## Monitoramento (RC-4.2.2)

A prontidão passou a ser **verificável automaticamente** pelo Monitor Operacional
Institucional (`productionMonitoringService`), com Health Score determinístico e endpoint
`/system/health` (somente leitura). Ver [PRODUCTION_MONITORING.md](./PRODUCTION_MONITORING.md).
