/**
 * RC-4.8 — Institutional Knowledge Pipeline
 *
 * Valida o pipeline institucional que orquestra todo o ciclo de vida do conhecimento (SEM Lei
 * 14.133/texto legal/jurisprudência/RAG/IA/banco/React/Business Domains): pipeline, 16 estágios,
 * quality gates, validation engine, publication, change detection (rollback/upgrade), projeção KG,
 * explainability, observabilidade. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import { INSTITUTIONAL_STAGES, ALL_STAGE_IDS, GATE_STAGE_IDS, isPipelineStage } from "../../domain/knowledge/pipeline/pipelineStages";
import {
  createInstitutionalPipelineDefinition, buildPipeline, getStage,
  createPipelineRegistry, registerPipeline, getPipelineDefinition,
} from "../../domain/knowledge/pipeline/knowledgePipeline";
import { executePipeline, DEFAULT_STAGE_HANDLERS } from "../../domain/knowledge/pipeline/pipelineExecution";
import { evaluateQualityGates } from "../../domain/knowledge/pipeline/qualityGates";
import {
  createValidationRegistry, registerRule, DEFAULT_VALIDATION_RULES, KnowledgeValidationEngine, buildHealthReport,
} from "../../domain/knowledge/pipeline/validationEngine";
import {
  KnowledgePublisher, createPublicationHistory, addSnapshot, latestSnapshot,
} from "../../domain/knowledge/pipeline/publicationEngine";
import {
  diffDocuments, buildChangeSet, analyzeImpact, buildMigrationPlan, buildUpgrade, buildRollback,
} from "../../domain/knowledge/pipeline/changeDetection";
import { projectPipeline } from "../../domain/knowledge/pipeline/pipelineProjection";
import { explainExecution } from "../../domain/knowledge/pipeline/pipelineExplainability";
import { samplePipeline, samplePipelineContext, SAMPLE_TIMES } from "../../domain/knowledge/pipeline/pipelineSample";
import { sampleKnowledgeDocument } from "../../domain/knowledge/knowledgeSample";
import { createSection, createKnowledgeDocument } from "../../domain/knowledge/knowledgeDocument";
import { createBlock } from "../../domain/knowledge/knowledgeBlocks";
import { evolveDocument } from "../../domain/knowledge/knowledgeVersion";
import { recordPipelineEvent, getPipelineEvents, clearPipelineEvents } from "../../services/knowledge/pipelineObservabilityService";

const ORG = 13400;
const T = "2026-01-01T00:00:00.000Z";

describe("RC-4.8 — Institutional Knowledge Pipeline", () => {

  // ─── Fase 2 — Pipeline Stages ───────────────────────────────────────────────
  describe("Pipeline Stages (16 estágios)", () => {
    it("declara os 16 estágios com gates e dependências", () => {
      expect(INSTITUTIONAL_STAGES).toHaveLength(16);
      expect(ALL_STAGE_IDS[0]).toBe("source_acquisition");
      expect(ALL_STAGE_IDS[ALL_STAGE_IDS.length - 1]).toBe("registry_update");
      expect(isPipelineStage("approval")).toBe(true);
      expect(isPipelineStage("nope")).toBe(false);
      expect(GATE_STAGE_IDS).toContain("approval");
      expect(GATE_STAGE_IDS).toContain("quality_validation");
    });
  });

  // ─── Fase 1 — Pipeline & Registry ───────────────────────────────────────────
  describe("Pipeline & Registry", () => {
    it("cria definição, monta ordem determinística e registra", () => {
      const def = createInstitutionalPipelineDefinition(ORG);
      const pipe = buildPipeline(def);
      expect(pipe.order).toHaveLength(16);
      expect(pipe.order[0]).toBe("source_acquisition");
      expect(pipe.order.indexOf("approval")).toBeGreaterThan(pipe.order.indexOf("review"));
      expect(getStage(pipe, "publication")!.dependencies).toContain("approval");
      let reg = createPipelineRegistry();
      reg = registerPipeline(reg, def);
      reg = registerPipeline(reg, def); // idempotente
      expect(reg.definitions).toHaveLength(1);
      expect(getPipelineDefinition(reg, def.id)!.name).toBe(def.name);
    });
  });

  // ─── Fase 3 — Execution ─────────────────────────────────────────────────────
  describe("Pipeline Execution", () => {
    it("executa todos os estágios → completed (documento válido)", () => {
      const pipe = samplePipeline(ORG);
      const ctx = samplePipelineContext(ORG);
      const result = executePipeline(pipe, ctx, {}, SAMPLE_TIMES);
      expect(result.execution.status).toBe("completed");
      expect(result.execution.failedStage).toBeNull();
      expect(result.execution.executedStages).toHaveLength(16);
      expect(result.execution.replayHash).toHaveLength(32);
      expect(result.stageResults).toHaveLength(16);
    });
    it("falha em quality gate → estágios seguintes pulados", () => {
      // documento sem blocos recomendados / sem Explainability → coverage falha
      const secao = createSection({ docKey: "vazio", title: "S", order: 1, blocks: [createBlock({ docKey: "vazio", kind: "OfficialText", order: 1, fragments: [{ text: "x" }] })] });
      const doc = createKnowledgeDocument({ tenantId: ORG, docKey: "vazio", title: "Vazio", sections: [secao], createdAt: T, updatedAt: T });
      const pipe = samplePipeline(ORG);
      const ctx = samplePipelineContext(ORG, "c", doc);
      const result = executePipeline(pipe, ctx, {}, SAMPLE_TIMES);
      expect(result.execution.status).toBe("failed");
      expect(result.execution.failedStage).toBe("quality_validation");
      expect(result.stageResults.find(r => r.stageId === "publication")!.status).toBe("skipped");
    });
    it("replay-safe: mesma entrada lógica → mesmo replayHash (ignorando tempo)", () => {
      const pipe = samplePipeline(ORG);
      const a = executePipeline(pipe, samplePipelineContext(ORG), {}, { startedAt: "t1", finishedAt: "t2" });
      const b = executePipeline(pipe, samplePipelineContext(ORG), {}, { startedAt: "z9", finishedAt: "z9" });
      expect(a.execution.replayHash).toBe(b.execution.replayHash);
    });
  });

  // ─── Fase 4 — Quality Gates ─────────────────────────────────────────────────
  describe("Quality Gates", () => {
    it("documento completo passa; incompleto falha em coverage/explainability", () => {
      expect(evaluateQualityGates({ document: sampleKnowledgeDocument(ORG) }).passed).toBe(true);
      const secao = createSection({ docKey: "x", title: "S", order: 1, blocks: [createBlock({ docKey: "x", kind: "OfficialText", order: 1, fragments: [{ text: "y" }] })] });
      const incompleto = createKnowledgeDocument({ tenantId: ORG, docKey: "x", title: "X", sections: [secao], createdAt: T, updatedAt: T });
      const gates = evaluateQualityGates({ document: incompleto });
      expect(gates.passed).toBe(false);
      expect(gates.failures.map(f => f.gate)).toContain("coverage");
      expect(gates.failures.map(f => f.gate)).toContain("explainability");
    });
    it("binding inconsistente bloqueia", () => {
      expect(evaluateQualityGates({ document: sampleKnowledgeDocument(ORG), bindingConsistent: false }).passed).toBe(false);
    });
  });

  // ─── Fase 5 — Validation Engine ─────────────────────────────────────────────
  describe("Validation Engine", () => {
    it("roda regras padrão e gera health report", () => {
      let reg = createValidationRegistry();
      for (const r of DEFAULT_VALIDATION_RULES) reg = registerRule(reg, r);
      const results = KnowledgeValidationEngine.run(reg, sampleKnowledgeDocument(ORG));
      expect(results.length).toBe(DEFAULT_VALIDATION_RULES.length);
      const report = buildHealthReport(results);
      expect(report.healthy).toBe(true);
      expect(report.errorCount).toBe(0);
      expect(report.score).toBe(1);
    });
  });

  // ─── Fase 6 — Publication Engine ────────────────────────────────────────────
  describe("Publication Engine", () => {
    it("publica documento válido (gates ok) e mantém histórico append-only", () => {
      const doc = sampleKnowledgeDocument(ORG);
      const outcome = KnowledgePublisher.publish({ tenantId: ORG, correlationId: "c", document: doc, approvedBy: "gestor", reason: "ok", publishedAt: T });
      expect(outcome.published).toBe(true);
      expect(outcome.snapshot!.manifest.checksum.length).toBeGreaterThan(0);
      let history = createPublicationHistory();
      history = addSnapshot(history, outcome.snapshot!);
      history = addSnapshot(history, outcome.snapshot!); // idempotente
      expect(history.snapshots).toHaveLength(1);
      expect(latestSnapshot(history)!.snapshotId).toBe(outcome.snapshot!.snapshotId);
    });
    it("NÃO publica se gates falham", () => {
      const secao = createSection({ docKey: "x", title: "S", order: 1, blocks: [createBlock({ docKey: "x", kind: "OfficialText", order: 1, fragments: [{ text: "y" }] })] });
      const incompleto = createKnowledgeDocument({ tenantId: ORG, docKey: "x", title: "X", sections: [secao], createdAt: T, updatedAt: T });
      const outcome = KnowledgePublisher.publish({ tenantId: ORG, correlationId: "c", document: incompleto, approvedBy: "g", reason: "r" });
      expect(outcome.published).toBe(false);
      expect(outcome.snapshot).toBeNull();
    });
  });

  // ─── Fase 7 — Change Detection ──────────────────────────────────────────────
  describe("Change Detection (diff/impact/migration/upgrade/rollback)", () => {
    it("detecta diferenças entre revisões e planeja migração", () => {
      const v1 = sampleKnowledgeDocument(ORG);
      const extra = createSection({ docKey: v1.docKey, title: "Nova", order: 9, blocks: [createBlock({ docKey: v1.docKey, kind: "Example", order: 1, fragments: [{ text: "novo" }] })] });
      const v2 = evolveDocument(v1, { sections: [...v1.sections, extra] }, T);
      const diff = diffDocuments(v1, v2);
      expect(diff.added.length).toBeGreaterThan(0);
      const changeSet = buildChangeSet(v1, v2);
      const impact = analyzeImpact(changeSet);
      expect(impact.requiresRepublish).toBe(true);
      expect(["low", "medium", "high"]).toContain(impact.severity);
      const plan = buildMigrationPlan(diff);
      expect(plan.steps.length).toBe(diff.added.length + diff.removed.length + diff.changed.length);
      const upgrade = buildUpgrade(v1, v2);
      expect(upgrade.toRevision).toBe(2);
      const rollback = buildRollback(v1.lineageId, 1, "reverter");
      expect(rollback.toRevision).toBe(1);
    });
  });

  // ─── Fase 8 — Graph Projection ──────────────────────────────────────────────
  describe("Graph Orchestration (projection)", () => {
    it("projeta pipeline/execution/stages/publication/knowledge/lineage determinísticos", () => {
      const pipe = samplePipeline(ORG);
      const ctx = samplePipelineContext(ORG);
      const result = executePipeline(pipe, ctx, {}, SAMPLE_TIMES);
      const pub = KnowledgePublisher.publish({ tenantId: ORG, correlationId: "c", document: ctx.document, approvedBy: "g", reason: "r", publishedAt: T });
      const p = projectPipeline(pipe, result, pub.snapshot!);
      expect(p.nodes.some(n => n.semanticType === "pipeline")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "execution")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "stage")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "publication")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "lineage")).toBe(true);
      expect(projectPipeline(pipe, result, pub.snapshot!)).toEqual(p); // determinismo
    });
  });

  // ─── Fase 10 — Explainability ───────────────────────────────────────────────
  describe("Explainability", () => {
    it("explica pipeline/etapas/validações/aprovação/versionamento", () => {
      const pipe = samplePipeline(ORG);
      const ctx = samplePipelineContext(ORG);
      const result = executePipeline(pipe, ctx, {}, SAMPLE_TIMES);
      const pub = KnowledgePublisher.publish({ tenantId: ORG, correlationId: "c", document: ctx.document, approvedBy: "g", reason: "r", publishedAt: T });
      const ex = explainExecution(pipe, result, pub);
      for (const f of ["origin", "pipeline", "executedStages", "skippedStages", "failedStage", "validations", "approvalReason", "rejectionReason", "versioning", "summary"]) expect(ex, f).toHaveProperty(f);
      expect(ex.versioning.published).toBe(true);
      expect(ex.approvalReason).toBeTruthy();
      expect(ex.rejectionReason).toBeNull();
    });
    it("explica rejeição quando gates falham", () => {
      const secao = createSection({ docKey: "x", title: "S", order: 1, blocks: [createBlock({ docKey: "x", kind: "OfficialText", order: 1, fragments: [{ text: "y" }] })] });
      const incompleto = createKnowledgeDocument({ tenantId: ORG, docKey: "x", title: "X", sections: [secao], createdAt: T, updatedAt: T });
      const pipe = samplePipeline(ORG);
      const result = executePipeline(pipe, samplePipelineContext(ORG, "c", incompleto), {}, SAMPLE_TIMES);
      const ex = explainExecution(pipe, result);
      expect(ex.failedStage).toBe("quality_validation");
      expect(ex.rejectionReason).toBeTruthy();
    });
  });

  // ─── Fase 9 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("registra eventos e recupera por correlationId; multi-tenant", () => {
      clearPipelineEvents();
      recordPipelineEvent({ correlationId: "corr-rc48", tenantId: ORG, type: "pipelineStarted", subjectId: "e1", detail: "start", count: 1 });
      recordPipelineEvent({ correlationId: "corr-rc48", tenantId: ORG, type: "publicationFinished", subjectId: "p1", detail: "pub", count: 1 });
      const evs = getPipelineEvents("corr-rc48");
      expect(evs.length).toBe(2);
      expect(evs.map(e => e.type)).toEqual(["pipelineStarted", "publicationFinished"]);
      expect(evs[0].tenantId).toBe(ORG);
      expect(getPipelineEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesma execução lógica → mesmos resultados de estágio", () => {
      const pipe = samplePipeline(ORG);
      const a = executePipeline(pipe, samplePipelineContext(ORG), {}, SAMPLE_TIMES);
      const b = executePipeline(pipe, samplePipelineContext(ORG), {}, SAMPLE_TIMES);
      expect(a.stageResults.map(r => [r.stageId, r.status])).toEqual(b.stageResults.map(r => [r.stageId, r.status]));
      void DEFAULT_STAGE_HANDLERS;
    });
  });
});
