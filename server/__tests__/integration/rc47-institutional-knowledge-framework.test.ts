/**
 * RC-4.7 — Institutional Knowledge Framework
 *
 * Valida o framework GENÉRICO de representação de conhecimento institucional (SEM Lei 14.133/
 * conteúdo jurídico/jurisprudência/RAG/IA/Business Domains/banco/React): documento, sistema de
 * blocos (20), qualidade/health, renderer (6 visões), lifecycle, versionamento, registry, projeção
 * KG, explainability, observabilidade. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import { ALL_BLOCK_KINDS, isBlockKind, createBlock } from "../../domain/knowledge/knowledgeBlocks";
import {
  createKnowledgeDocument, createSection, allBlocks, isValidDocument,
} from "../../domain/knowledge/knowledgeDocument";
import {
  ALL_LIFECYCLE_STATES, canTransitionLifecycle, isPublished, isTerminalLifecycle,
} from "../../domain/knowledge/knowledgeLifecycle";
import {
  evolveDocument, bumpSemver, buildRevisionChains, isRevisionChainConsistent, latestRevision,
  logicalRollback, revisionHistory,
} from "../../domain/knowledge/knowledgeVersion";
import {
  computeQuality, computeCompleteness, validateDocument, RECOMMENDED_BLOCKS,
} from "../../domain/knowledge/knowledgeQuality";
import { renderKnowledge, renderAllViews, ALL_VIEWS } from "../../domain/knowledge/knowledgeRenderer";
import {
  createKnowledgeRegistry, addDocument, getDocument, resolvePublished, resolveByKey, resolveVersions,
  buildKnowledgeIndex, buildKnowledgeCatalog, buildSearchMetadata,
} from "../../domain/knowledge/knowledgeRegistry";
import { projectKnowledgeDocument } from "../../domain/knowledge/knowledgeProjection";
import { explainDocument } from "../../domain/knowledge/knowledgeExplainability";
import { sampleKnowledgeDocument } from "../../domain/knowledge/knowledgeSample";
import {
  recordInstitutionalKnowledgeEvent, getInstitutionalKnowledgeEvents, clearInstitutionalKnowledgeEvents,
} from "../../services/knowledge/institutionalKnowledgeObservabilityService";

const ORG = 13300;
const T = "2026-01-01T00:00:00.000Z";

describe("RC-4.7 — Institutional Knowledge Framework", () => {

  // ─── Part 2 — Block System ──────────────────────────────────────────────────
  describe("Block System (20 tipos)", () => {
    it("declara os 20 tipos e cria blocos com fragmentos determinísticos", () => {
      expect(ALL_BLOCK_KINDS).toHaveLength(20);
      expect(isBlockKind("Checklist")).toBe(true);
      expect(isBlockKind("Nope")).toBe(false);
      const b = createBlock({ docKey: "d", kind: "Checklist", order: 1, fragments: [{ text: "a" }, { text: "b" }] });
      expect(b.fragments).toHaveLength(2);
      expect(createBlock({ docKey: "d", kind: "Checklist", order: 1, fragments: [{ text: "a" }, { text: "b" }] }).id).toBe(b.id);
    });
  });

  // ─── Part 1 — Document Model ────────────────────────────────────────────────
  describe("KnowledgeDocument (genérico, multi-tenant, replay-safe)", () => {
    it("possui todos os campos, é válido e determinístico", () => {
      const doc = sampleKnowledgeDocument(ORG);
      for (const f of ["id", "tenantId", "docKey", "title", "sections", "references", "relationships", "semver", "revision", "lifecycleState", "lineageId", "metadata", "replayHash"]) expect(doc, f).toHaveProperty(f);
      expect(isValidDocument(doc)).toBe(true);
      expect(doc.replayHash).toHaveLength(32);
      expect(allBlocks(doc).length).toBeGreaterThan(5);
      expect(sampleKnowledgeDocument(ORG).replayHash).toBe(doc.replayHash);
    });
    it("multi-tenant: mesma chave em tenants distintos → ids/linhagens distintos", () => {
      expect(sampleKnowledgeDocument(1).lineageId).not.toBe(sampleKnowledgeDocument(2).lineageId);
    });
  });

  // ─── Part 5 — Lifecycle ─────────────────────────────────────────────────────
  describe("Lifecycle (replay-safe)", () => {
    it("estados e transições válidas", () => {
      expect(ALL_LIFECYCLE_STATES).toHaveLength(6);
      expect(canTransitionLifecycle("draft", "review")).toBe(true);
      expect(canTransitionLifecycle("review", "approval")).toBe(true);
      expect(canTransitionLifecycle("approval", "published")).toBe(true);
      expect(canTransitionLifecycle("draft", "published")).toBe(false);
      expect(isPublished("published")).toBe(true);
      expect(isTerminalLifecycle("archived")).toBe(true);
    });
  });

  // ─── Part 6 — Versionamento ─────────────────────────────────────────────────
  describe("Versionamento (append-only, semver, rollback lógico)", () => {
    it("evolveDocument cria nova revisão bumpando semver; anterior imutável", () => {
      const v1 = sampleKnowledgeDocument(ORG);
      const v2 = evolveDocument(v1, { lifecycleState: "review" }, T);
      expect(v2.revision).toBe(2);
      expect(v2.semver).toBe("1.0.1");
      expect(v2.lineageId).toBe(v1.lineageId);
      expect(v1.revision).toBe(1); // imutável
      expect(bumpSemver("1.2.3", "major")).toBe("2.0.0");
      expect(bumpSemver("1.2.3", "minor")).toBe("1.3.0");
      const chain = buildRevisionChains([v1, v2])[0];
      expect(chain.revisions.map(r => r.revision)).toEqual([1, 2]);
      expect(isRevisionChainConsistent(chain)).toBe(true);
      expect(latestRevision(chain)!.revision).toBe(2);
      // rollback lógico não remove revisões posteriores
      expect(logicalRollback([v1, v2], v1.lineageId, 1)!.id).toBe(v1.id);
      expect(revisionHistory([v1, v2], v1.lineageId)).toHaveLength(2);
    });
  });

  // ─── Part 3 — Quality & Health ──────────────────────────────────────────────
  describe("Knowledge Quality & Health", () => {
    it("computa completeness/coverage/consistency/health determinísticos", () => {
      const doc = sampleKnowledgeDocument(ORG);
      const q = computeQuality(doc);
      expect(q.completeness.score).toBeGreaterThan(0);
      expect(q.coverage.blockCount).toBe(allBlocks(doc).length);
      expect(q.consistency.issues).toEqual([]);
      expect(["healthy", "incomplete", "degraded"]).toContain(q.health.status);
      expect(computeQuality(doc)).toEqual(q); // determinismo
      // completeness reflete blocos recomendados
      expect(RECOMMENDED_BLOCKS.length).toBeGreaterThan(0);
      const c = computeCompleteness(doc);
      expect(c.presentRecommended).toContain("ExecutiveSummary");
    });
    it("bloco sem fragmentos gera issue de consistência", () => {
      const empty = createSection({ docKey: "d", title: "S", order: 1, blocks: [createBlock({ docKey: "d", kind: "Risk", order: 1, fragments: [] })] });
      const doc = createKnowledgeDocument({ tenantId: ORG, docKey: "d", title: "T", sections: [empty], createdAt: T, updatedAt: T });
      expect(computeQuality(doc).consistency.issues.length).toBeGreaterThan(0);
      expect(validateDocument(doc).valid).toBe(true); // validação estrutural passa; consistência é métrica
    });
  });

  // ─── Part 4 — Renderer (6 visões) ───────────────────────────────────────────
  describe("Knowledge Renderer", () => {
    it("renderiza as 6 visões determinísticas com filtros distintos", () => {
      const doc = sampleKnowledgeDocument(ORG);
      expect(ALL_VIEWS).toHaveLength(6);
      const inst = renderKnowledge(doc, "institutional");
      const copilot = renderKnowledge(doc, "copilot");
      expect(inst.blocks.length).toBe(allBlocks(doc).length); // institutional = todos
      expect(copilot.blocks.every(b => ["ExecutiveSummary", "PlainLanguage", "PracticalInterpretation", "Checklist", "FAQ", "Example"].includes(b.kind))).toBe(true);
      const audit = renderKnowledge(doc, "audit");
      expect(audit.meta.quality).toBeDefined();
      const all = renderAllViews(doc);
      expect(Object.keys(all)).toHaveLength(6);
      expect(renderKnowledge(doc, "copilot")).toEqual(copilot); // determinismo
    });
  });

  // ─── Part 7 — Registry ──────────────────────────────────────────────────────
  describe("Knowledge Registry / Resolver / Index / Catalog / Search", () => {
    it("registra (append-only), resolve publicados e por chave, indexa e cataloga", () => {
      const v1 = sampleKnowledgeDocument(ORG);
      const v2 = evolveDocument(v1, { lifecycleState: "published", semverLevel: "minor" }, T);
      let reg = createKnowledgeRegistry();
      reg = addDocument(reg, v1);
      reg = addDocument(reg, v2);
      reg = addDocument(reg, v2); // idempotente
      expect(reg.documents).toHaveLength(2);
      expect(getDocument(reg, v2.id)!.revision).toBe(2);
      // publicados: última revisão da linhagem é published
      expect(resolvePublished(reg).map(d => d.id)).toEqual([v2.id]);
      expect(resolveByKey(reg, v1.docKey)).toHaveLength(2);
      expect(resolveVersions(reg, v1.lineageId)).toHaveLength(2);
      expect(buildKnowledgeIndex(reg).byKey[v1.docKey]).toHaveLength(2);
      expect(buildKnowledgeCatalog(reg).entries).toHaveLength(2);
      const sm = buildSearchMetadata(v1);
      expect(sm.blockKinds).toContain("Checklist");
      expect(sm.terms).toContain(v1.docKey.toLowerCase());
    });
  });

  // ─── Part 8 — Graph Projection ──────────────────────────────────────────────
  describe("Knowledge Graph Projection", () => {
    it("projeta document/block/lifecycle/version/health determinísticos", () => {
      const doc = sampleKnowledgeDocument(ORG);
      const p = projectKnowledgeDocument(doc);
      expect(p.nodes.some(n => n.semanticType === "document")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "block")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "lifecycle")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "version")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "health")).toBe(true);
      expect(p.edges.some(e => e.type === "contains")).toBe(true);
      expect(projectKnowledgeDocument(doc)).toEqual(p); // determinismo
    });
  });

  // ─── Part 10 — Explainability ───────────────────────────────────────────────
  describe("Explainability", () => {
    it("explica origem/estrutura/versão/relacionamentos/validações/estado/lifecycle/lineage", () => {
      const doc = sampleKnowledgeDocument(ORG);
      const ex = explainDocument(doc);
      for (const f of ["origin", "structure", "version", "relationships", "references", "validations", "quality", "state", "lifecycleNext", "lineageId", "summary"]) expect(ex, f).toHaveProperty(f);
      expect(ex.structure.blocks).toBe(allBlocks(doc).length);
      expect(ex.lifecycleNext).toContain("review");
      expect(ex.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── Part 9 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("registra eventos e recupera por correlationId; multi-tenant", () => {
      clearInstitutionalKnowledgeEvents();
      recordInstitutionalKnowledgeEvent({ correlationId: "corr-rc47", tenantId: ORG, type: "knowledgeCreated", subjectId: "d1", detail: "criado", count: 1 });
      recordInstitutionalKnowledgeEvent({ correlationId: "corr-rc47", tenantId: ORG, type: "knowledgeRendered", subjectId: "d1", detail: "render", count: 6 });
      const evs = getInstitutionalKnowledgeEvents("corr-rc47");
      expect(evs.length).toBe(2);
      expect(evs.map(e => e.type)).toEqual(["knowledgeCreated", "knowledgeRendered"]);
      expect(evs[0].tenantId).toBe(ORG);
      expect(getInstitutionalKnowledgeEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesmo documento → mesma qualidade, projeção e renderização", () => {
      const a = sampleKnowledgeDocument(ORG); const b = sampleKnowledgeDocument(ORG);
      expect(computeQuality(a)).toEqual(computeQuality(b));
      expect(projectKnowledgeDocument(a)).toEqual(projectKnowledgeDocument(b));
      expect(renderAllViews(a)).toEqual(renderAllViews(b));
    });
  });
});
