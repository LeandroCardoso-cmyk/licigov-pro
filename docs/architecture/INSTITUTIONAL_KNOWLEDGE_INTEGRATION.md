# Institutional Knowledge Integration Layer (RC-5.0)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> Camada **exclusivamente arquitetural** que integra o **Kernel Cognitivo** ao **Official Knowledge
> Corpus** mantendo **baixo acoplamento**. Não cria chat, interface, módulo de dúvidas nem RAG/cache
> paralelo. Não altera Business Domains, UX, Copilots, o Official Knowledge Corpus nem o Knowledge
> Pipeline. Nenhuma funcionalidade visível ao usuário. Determinística, replay-safe, multi-tenant.

## Problema

O sistema tinha duas estruturas independentes e funcionais, porém **sem integração**:

1. **Kernel Cognitivo:** Business Domain → `executeCognitiveTask()` → Orchestrator → Copilots → AIExecutionEngine → LLM.
2. **Official Knowledge Corpus:** Federal → Estado → Município → documentos oficiais (RC-4.9/4.9.1).

Esta RC cria **apenas a ponte** entre elas.

## Princípio arquitetural

```
PROIBIDO   Business Domain → AIExecutionEngine → Official Corpus
OBRIGATÓRIO Business Domain → executeCognitiveTask() → Orchestrator →
            InstitutionalContextResolver → KnowledgeRetrieval → ContextPackage → AIExecutionEngine
```

O **Official Knowledge Corpus JAMAIS é acessado diretamente** pelos Copilots ou pelo AIExecutionEngine —
somente por esta camada.

## Componentes (`server/domain/institutionalIntegration/` + `server/services/institutionalIntegration/`)

| # | Componente | Arquivo | Papel |
|---|---|---|---|
| 1 | **InstitutionalContextResolver** | `domain/.../institutionalContextResolver.ts` | Recebe tenant/businessDomain/taskType/userContext → resolve **Federal → Estado → Município → documentos** (reusa a resolução hierárquica da RC-4.9). Determinístico, sem LLM. |
| 2 | **KnowledgeRetrievalService** | `services/.../knowledgeRetrievalService.ts` | Consulta **exclusivamente** o Official Corpus; seleciona documentos e recupera **trechos** por correspondência lexical determinística. Preserva documentId/authority/version/jurisdiction/bindingLevel/citation/lineage. Sem IA/sumarização. |
| 3 | **ContextPackage** | `domain/.../contextPackage.ts` | Estrutura **única e imutável** (`tenant`, `municipality`, `state`, `businessDomain`, `taskType`, `documents[]`, `retrievedPassages[]`, `citations[]`, `bindingLevels[]`, `explainability[]`, `metadata`, `replayHash`). Módulo **puro** (não importa o Corpus) — é o tipo que o engine consome. |
| — | **API / Orchestrator seam** | `services/.../institutionalKnowledgeIntegration.ts` | `resolveInstitutionalContextPackage()` (o passo do Orchestrator) e `executeCognitiveTaskWithInstitutionalContext()` (resolve → engine). |
| — | **Observabilidade** | `services/.../institutionalIntegrationObservabilityService.ts` | contextResolution, knowledgeRetrieval, documentsLoaded/Ignored, contextPackageBuilt — por correlationId/replayId. |

## Fluxo

```
Business Domain
   │  executeCognitiveTask(...) / orchestrateMultiCopilot({..., institutional})
   ▼
Orchestrator (workspaceOrchestratorService)
   │  resolveInstitutionalContextPackage(corpus, {tenantId, businessDomain, taskType, query})
   ▼
InstitutionalContextResolver → KnowledgeRetrievalService → ContextPackage (imutável, replayHash)
   ▼
AIExecutionEngine (executeCognitiveTask) — CONSOME o ContextPackage
```

## Integração com o AIExecutionEngine

O `executeCognitiveTask` recebe um campo **opcional** `contextPackage`. Quando presente, o engine
**apenas consome** o pacote (mescla `documents`/`citations` nos insumos usados e registra
`institutionalContextRef = contextPackage.replayHash`). O engine **NÃO** consulta banco, corpus,
tenant, legislação ou hierarquia — só consome o pacote pronto. **Sem novos estágios** de pipeline
(ordem de estágios inalterada) → **zero regressões**; ausência do pacote preserva o comportamento
anterior.

## Integração com o Orchestrator

`orchestrateMultiCopilot` recebe um parâmetro **opcional** `institutional`. Quando informado, resolve
o ContextPackage (Resolver → Retrieval) e o inclui no resultado. Sem o parâmetro, o fluxo existente é
**idêntico** (retrocompatível).

## Multi-Tenant (isolamento absoluto)

- **Federais:** compartilhados por todos os tenants.
- **Estaduais:** compartilhados por estado.
- **Municipais:** pertencem **apenas** ao respectivo tenant. Um tenant **jamais** recebe documentos
  municipais de outro tenant (garantido por teste).

Exemplo (tenant Moreira Sales): `Lei Municipal 769 → Prejulgado 27 → Manual TCE → Lei 14.133 → LC 123
→ IN SEGES → Manual TCU` — resolução automática, hierárquica.

## Garantias

- **Replay Safety:** mesma entrada → mesmo contexto, documentos, trechos e `replayHash`. Sem aleatoriedade.
- **Imutável / Versionado / Auditável:** ContextPackage congelado com `contract` (`institutional-context/1.0`).
- **Explainability:** toda recuperação registra documento, trecho, autoridade, versão, bindingLevel, lineage.
- **Baixo acoplamento:** o engine importa apenas o **tipo** ContextPackage (módulo puro); o Corpus é
  acessado só por esta camada.

## Limites arquiteturais

Esta camada **não executa IA**, **não interpreta documentos** e **não responde perguntas**. Não cria
RAG/cache paralelo nem infraestrutura duplicada. É a **única** ponte entre Kernel e Corpus.

## Garantias por teste (`rc50-institutional-knowledge-integration.test.ts`)

Context Resolution (hierarquia + determinismo), Knowledge Retrieval (trechos + preservação de
metadados + verbatim), ContextPackage (imutável + campos + replay + derivação de bindingLevels),
isolamento multi-tenant, hierarquia federal/estadual/municipal, integração com o Orchestrator
(com/sem `institutional`), integração com o AIExecutionEngine (consome pacote + zero-regressão sem
pacote), explainability, observabilidade por correlationId, replay safety. **Zero regressões.**
