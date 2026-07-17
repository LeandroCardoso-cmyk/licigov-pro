# Institutional Knowledge Pipeline (RC-4.8)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO cria conteúdo jurídico.** Não implementa Lei 14.133, texto legal, jurisprudência,
> RAG, IA, banco, migrations, React nem Business Domains. Cria o **pipeline** que orquestra o ciclo
> de vida de qualquer corpus. Replay-safe, determinístico, auditável, explicável, versionado,
> observável, approval-aware, governável.

## Product North Star

**Todo conhecimento institucional nasce obrigatoriamente por este pipeline.** Nenhum Knowledge
Package pode ser criado fora dele. Será usado por Lei 14.133, LC 123, Constituição, Decretos, IN
SEGES, TCU, AGU, TCEs, normas municipais e conhecimento institucional próprio.

```
Source Acquisition → Corpus Validation → Normative Resolution → Knowledge Mapping →
Knowledge Document Generation → Binding Resolution → Relationship Resolution →
[Quality Validation] → [Consistency Validation] → [Explainability Validation] →
Review → [Approval] → Publication → Index Update → Graph Projection → Registry Update
                                   ([...] = quality gate obrigatório)
```

## Componentes (`server/domain/knowledge/pipeline/`)

| Fase | Componente | Arquivo |
|---|---|---|
| 1 | **KnowledgePipeline** + Definition/Stage/Context/Registry | `knowledgePipeline.ts` |
| 2 | **Pipeline Stages** — os 16 estágios institucionais | `pipelineStages.ts` |
| 3 | **Execution** — KnowledgePipelineExecution + Result (executa determinístico) | `pipelineExecution.ts` |
| 4 | **Quality Gates** — coverage/binding/explainability/references/relationships/versioning | `qualityGates.ts` |
| 5 | **Validation Engine** — Engine/Rule/Result/Registry/HealthReport | `validationEngine.ts` |
| 6 | **Publication Engine** — Publisher/Context/Manifest/Version/Snapshot/History | `publicationEngine.ts` |
| 7 | **Change Detection** — Diff/ChangeSet/ImpactAnalysis/MigrationPlan/Upgrade/Rollback | `changeDetection.ts` |
| 8 | **Graph Orchestration** — projeta Pipeline/Execution/Stages/Publications/Knowledge/Lineage | `pipelineProjection.ts` |
| 10 | **Explainability** — origem/pipeline/etapas/validações/aprovação/rejeição/versão/impacto | `pipelineExplainability.ts` |
| 9 | **Observabilidade** — eventos por correlationId | `server/services/knowledge/pipelineObservabilityService.ts` |

## Quality Gates (Fase 4)

Nenhum corpus é publicado se: **coverage < 100%** (blocos recomendados ausentes), **binding
inconsistente**, **explainability ausente**, **referências inválidas**, **relacionamentos quebrados**
ou **versionamento inválido**. Os gates são aplicados pelos estágios `quality_validation`,
`consistency_validation`, `explainability_validation` e `approval` — um gate que falha **interrompe**
a execução e impede a publicação.

## Execution (Fase 3)

Cada execução carrega `pipelineExecutionId`, `correlationId`, `startedAt`/`finishedAt`, `status`,
`currentStage`, `executedStages`, `failedStage`, `warnings`, `errors`, `metrics`, `lineage` e
`replayHash`. O `replayHash` **exclui tempos** — mesma execução lógica → mesmo hash.

## Publication (Fase 6)

`KnowledgePublisher.publish` só gera um `PublicationSnapshot` **imutável** (manifest + checksum +
version) se os quality gates passarem; caso contrário retorna `published: false`. O `PublicationHistory`
é **append-only**.

## Change Detection (Fase 7)

`diffDocuments` compara revisões por bloco (fingerprint); `analyzeImpact` classifica severidade e
necessidade de republicação; `buildMigrationPlan`/`buildUpgrade` produzem passos determinísticos;
`buildRollback` descreve um rollback lógico (sem apagar revisões).

## Garantias

- **Replay Safety / Determinismo:** ordem estável; hashes sem tempo; mesma entrada → mesmo resultado.
- **Governável / Approval-aware:** gates obrigatórios; publicação condicionada à aprovação.
- **Auditável / Explicável / Observável:** toda execução/publicação se explica e é observável.
- **Versionado / Multi-tenant / Baixo acoplamento:** consome o Institutional Knowledge Framework
  (RC-4.7); não altera Kernel/IA/Business Domains; **sem conteúdo jurídico**.

## Garantias por teste (`rc48-institutional-knowledge-pipeline.test.ts`, ORG 13400)

16 estágios + gates, pipeline & registry, execução (completa + falha em gate propaga skip +
replay-safe), quality gates (completo passa / incompleto falha / binding inconsistente), validation
engine + health report, publication (publica válido / bloqueia inválido / histórico append-only),
change detection (diff/impact/migration/upgrade/rollback), projeção KG determinística, explainability
(aprovação e rejeição), observabilidade por correlationId, replay safety. **Zero regressões.**

## Resultado

Pipeline institucional completo para criação e evolução de qualquer corpus. Todo novo conhecimento
passa obrigatoriamente por ele. As próximas RCs usarão este pipeline para ingerir conteúdo (ex.: a
Lei nº 14.133 como `KnowledgeDocument`s), sem qualquer alteração da arquitetura.
