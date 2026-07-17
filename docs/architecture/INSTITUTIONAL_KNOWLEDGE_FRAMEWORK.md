# Institutional Knowledge Framework (RC-4.7)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO insere conteúdo jurídico.** Não contém texto da Lei 14.133, jurisprudência,
> RAG, IA, Business Domains, banco, migrations nem React. Cria o **padrão institucional genérico**
> que rege TODOS os Knowledge Packages futuros. **Última grande RC de infraestrutura cognitiva** —
> após ela, a arquitetura jurídica é considerada estável. Multi-tenant, determinística, replay-safe.

## O que é

Define **como qualquer conhecimento institucional** é estruturado, validado, versionado, explicado,
renderizado, consultado e evoluído. **Completamente genérico e sem acoplamento** com Lei 14.133,
decretos, IN SEGES, TCU, AGU, TCE ou municípios — esses conteúdos são apenas **consumidores** do
framework. Vive em `server/domain/knowledge/`.

```
KnowledgeDocument → Sections → Blocks (20 tipos) → Fragments
       │ versão semântica · lifecycle · lineage · quality/health
       ▼
Renderer (6 visões) · Registry/Resolver/Index/Catalog · Graph Projection · Explainability
```

## Componentes

| Parte | Componente | Arquivo | Papel |
|---|---|---|---|
| 1 | **KnowledgeDocument** + Section/Reference/Relationship/Metadata | `knowledgeDocument.ts` | Modelo genérico (id, tenantId, docKey, title, sections, references, relationships, semver, revision, lifecycleState, lineageId, replayHash). |
| 2 | **Block System** (20 tipos) | `knowledgeBlocks.ts` | OfficialText, ExecutiveSummary, PlainLanguage, PracticalInterpretation, Applicability, Requirements, Restrictions, Exception, Checklist, Workflow, Example, Risk, FAQ, CrossReference, RelatedNorms, RelatedKnowledge, RelatedDocument, Observations, FutureUpdate, Explainability. |
| 3 | **Knowledge Quality** | `knowledgeQuality.ts` | Completeness, Coverage, Consistency, Validator, Health — determinísticos. |
| 4 | **Knowledge Renderer** | `knowledgeRenderer.ts` | 6 visões: Institutional, Copilot, Explainability, Audit, Review, Export. |
| 5 | **Lifecycle** | `knowledgeLifecycle.ts` | draft → review → approval → published → deprecated → archived + transições (replay-safe). |
| 6 | **Versionamento** | `knowledgeVersion.ts` | Append-only, immutable snapshots, semver, lineage, rollback lógico, revision history. |
| 7 | **Registry** | `knowledgeRegistry.ts` | KnowledgeRegistry, Resolver, Index, Catalog, SearchMetadata. |
| 8 | **Graph Projection** | `knowledgeProjection.ts` | Document, Block, Relationship, Reference, Lifecycle, Version, Health. |
| 10 | **Explainability** | `knowledgeExplainability.ts` | Origem, estrutura, versão, relacionamentos, validações, estado, lifecycle, lineage. |
| 9 | **Observabilidade** | `server/services/knowledge/institutionalKnowledgeObservabilityService.ts` | Eventos (created/reviewed/approved/published/updated/deprecated/queried/rendered) por **correlationId**. |

## Block System (Part 2)

Sistema **modular**: cada documento combina qualquer conjunto dos 20 blocos cognitivos. Cada bloco
tem tipo, ordem, título e fragmentos. O framework não presume quais blocos um documento terá —
apenas oferece o vocabulário e a estrutura.

## Renderer (Part 4)

Uma mesma estrutura de conhecimento é projetada em 6 visões determinísticas — cada uma filtra/
prioriza blocos distintos (ex.: **Copilot** enfatiza resumo/linguagem simples/FAQ; **Audit** inclui
qualidade/versão/lineage; **Explainability** foca blocos de explicação e relacionamentos). **Sem
React** — o renderer produz dados; a UI é responsabilidade de outra camada.

## Lifecycle & Versionamento (Parts 5 e 6)

O ciclo `draft → review → approval → published → deprecated → archived` é replay-safe. Cada
evolução gera uma **nova revisão imutável** (`evolveDocument`, semver bumped, mesma linhagem);
`logicalRollback` retorna um snapshot anterior **sem** apagar revisões posteriores.

## Garantias

- **Genérico / baixo acoplamento:** nenhum acoplamento com conteúdo/leis; corpora futuros são
  consumidores.
- **Multi-tenant:** todo documento carrega `tenantId`; linhagem/id incluem o tenant.
- **Replay Safety:** id/lineage/replayHash via sha256 (sem createdAt/updatedAt no hash);
  qualidade/projeção/renderização determinísticas.
- **Versionamento append-only** + **Explainability** + **Observabilidade** + **Auditabilidade**.

## Garantias por teste (`rc47-institutional-knowledge-framework.test.ts`, ORG 13300)

Block System (20 tipos + fragmentos determinísticos), documento (campos + multi-tenant + determinismo),
lifecycle (transições), versionamento (evolve + semver + rollback lógico + histórico), quality/health
(completeness/coverage/consistency + issue de bloco vazio), renderer (6 visões filtradas + determinismo),
registry (append-only + publicados + índice/catálogo/busca), projeção KG determinística, explainability,
observabilidade por correlationId, replay safety. **Zero regressões.**

## Estabilidade da camada cognitiva

Com esta RC, o **framework institucional de representação de conhecimento está completo**. Todos os
corpora futuros o utilizam. A arquitetura da camada cognitiva é considerada **estável** — as próximas
implementações concentram-se **exclusivamente na criação de conteúdo institucional** (ex.: a ingestão
da Lei nº 14.133 como `KnowledgeDocument`s vinculados aos `NormativeNode` via Knowledge Binding).
