/**
 * RC-4.5.1 — Institutional Corpus Framework
 *
 * Valida a camada ORGANIZACIONAL permanente onde todo conhecimento institucional viverá
 * (SEM Lei 14.133/decretos/IN/TCU/TCE/doutrina/jurisprudência): corpus, tipos, coleções,
 * hierarquia, registro, integração com a Legal Knowledge Foundation, projeção KG, consultas,
 * versionamento, explainability, observabilidade. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import {
  createInstitutionalCorpus, isValidCorpus, computeCorpusLineage, type InstitutionalCorpus,
} from "../../domain/corpus/institutionalCorpus";
import { ALL_CORPUS_TYPES, CORPUS_TYPES, isCorpusType, getCorpusType } from "../../domain/corpus/corpusTypes";
import { createKnowledgeCollection, addMember, removeMember, isValidCollection } from "../../domain/corpus/knowledgeCollection";
import {
  DEFAULT_SCOPE_TAXONOMY, isScopeLevel, scopeDepth, buildCorpusHierarchy, hasHierarchyCycle,
} from "../../domain/corpus/corpusHierarchy";
import { buildCorpusRegistry, registerCorpus, findRegistryEntry, registryByType } from "../../domain/corpus/corpusRegistry";
import { attachLegalKnowledge } from "../../domain/corpus/corpusIntegration";
import { structuralSampleFramework, createCorpusFramework } from "../../domain/corpus/corpusFramework";
import { projectCorpusFramework } from "../../domain/corpus/corpusProjection";
import {
  findCorpus, findCollections, findKnowledgeByCorpus, findKnowledgeByCollection,
  findCorpusHierarchy, findCorpusDependencies, findCorpusChildren, findCorpusParents, findCorpusMetadata,
} from "../../domain/corpus/corpusQueries";
import {
  evolveCorpus, activateCorpus, deprecateCorpus, buildCorpusVersionChains,
  isCorpusVersionChainConsistent, latestCorpusVersion,
} from "../../domain/corpus/corpusVersion";
import { explainCorpus } from "../../domain/corpus/corpusExplainability";
import { validateCorpusFramework } from "../../domain/corpus/corpusValidation";
import { structuralSampleBase } from "../../domain/legalKnowledge/knowledgeBase";
import { recordCorpusEvent, getCorpusEvents, clearCorpusEvents } from "../../services/knowledge/corpusObservabilityService";

const ORG = 12700;
const T = "2026-01-01T00:00:00.000Z";
const corpus = (over: Partial<Parameters<typeof createInstitutionalCorpus>[0]> = {}): InstitutionalCorpus =>
  createInstitutionalCorpus({ tenantId: ORG, name: "Corpus X", type: "federal", scope: "uniao", jurisdiction: "federal", owner: "Depto", createdAt: T, updatedAt: T, ...over });

describe("RC-4.5.1 — Institutional Corpus Framework", () => {

  // ─── Part 1 — InstitutionalCorpus ───────────────────────────────────────────
  describe("InstitutionalCorpus (estrutura, multi-tenant, replay-safe)", () => {
    it("possui todos os campos e é determinístico (mesmos insumos → mesmo id/replayHash)", () => {
      const a = corpus(); const b = corpus();
      for (const f of ["id", "tenantId", "name", "description", "type", "scope", "jurisdiction", "owner", "parentId", "version", "status", "language", "lineageId", "metadata", "createdAt", "updatedAt", "replayHash"]) expect(a, f).toHaveProperty(f);
      expect(a.id).toBe(b.id);
      expect(a.replayHash).toBe(b.replayHash);
      expect(a.replayHash).toHaveLength(32);
      expect(a.status).toBe("draft");
      expect(a.language).toBe("pt-BR");
      expect(isValidCorpus(a)).toBe(true);
    });
    it("multi-tenant: mesma origem em tenants diferentes → linhagens/ids distintos", () => {
      expect(computeCorpusLineage({ tenantId: 1, type: "federal", owner: "D", name: "N" }))
        .not.toBe(computeCorpusLineage({ tenantId: 2, type: "federal", owner: "D", name: "N" }));
      expect(corpus({ tenantId: 1 }).id).not.toBe(corpus({ tenantId: 2 }).id);
    });
  });

  // ─── Part 2 — Corpus Types ──────────────────────────────────────────────────
  describe("Corpus Types (catálogo oficial, expansível)", () => {
    it("declara os 10 tipos oficiais e permite verificação/consulta", () => {
      expect(ALL_CORPUS_TYPES).toHaveLength(10);
      for (const id of ALL_CORPUS_TYPES) {
        expect(isCorpusType(id)).toBe(true);
        expect(getCorpusType(id).name.length).toBeGreaterThan(0);
      }
      expect(CORPUS_TYPES.federal.nature).toBe("governamental");
      expect(isCorpusType("inexistente")).toBe(false);
    });
  });

  // ─── Part 3 — KnowledgeCollection ───────────────────────────────────────────
  describe("KnowledgeCollection (pertence a exatamente um corpus)", () => {
    it("cria, adiciona/remove membros (append-only) e é determinística", () => {
      const c = corpus();
      const col = createKnowledgeCollection({ tenantId: ORG, corpusId: c.id, name: "Coleção", createdAt: T });
      expect(isValidCollection(col)).toBe(true);
      expect(col.corpusId).toBe(c.id);
      const col2 = addMember(col, { kind: "legal_unit", refId: "u1", note: "x" }, T);
      expect(col2.members).toHaveLength(1);
      expect(col.members).toHaveLength(0); // imutável (append-only)
      const col3 = addMember(col2, { kind: "legal_unit", refId: "u1", note: "x" }, T); // idempotente
      expect(col3.members).toHaveLength(1);
      const col4 = removeMember(col2, "legal_unit", "u1", T);
      expect(col4.members).toHaveLength(0);
      // determinismo
      expect(createKnowledgeCollection({ tenantId: ORG, corpusId: c.id, name: "Coleção", createdAt: T }).id).toBe(col.id);
    });
  });

  // ─── Part 4 — Corpus Hierarchy ──────────────────────────────────────────────
  describe("Corpus Hierarchy (configurável, sem país específico, acíclica)", () => {
    it("taxonomia de escopo configurável e árvore sem ciclos", () => {
      expect(DEFAULT_SCOPE_TAXONOMY.length).toBeGreaterThanOrEqual(6);
      expect(isScopeLevel(DEFAULT_SCOPE_TAXONOMY, "municipio")).toBe(true);
      expect(scopeDepth(DEFAULT_SCOPE_TAXONOMY, "uniao")).toBe(1);
      const raiz = corpus({ name: "Raiz", scope: "uniao" });
      const filho = corpus({ name: "Filho", type: "estadual", scope: "estado", parentId: raiz.id });
      const neto = corpus({ name: "Neto", type: "municipal", scope: "municipio", parentId: filho.id });
      const h = buildCorpusHierarchy([raiz, filho, neto]);
      expect(h.roots).toEqual([raiz.id]);
      expect(h.nodes.find(n => n.corpusId === raiz.id)!.children).toEqual([filho.id]);
      expect(hasHierarchyCycle([raiz, filho, neto])).toBe(false);
    });
    it("detecta ciclo na hierarquia", () => {
      const a = corpus({ name: "A" });
      const b = corpus({ name: "B", parentId: a.id });
      // força ciclo: a aponta para b
      const aCycle: InstitutionalCorpus = { ...a, parentId: b.id };
      expect(hasHierarchyCycle([aCycle, b])).toBe(true);
    });
  });

  // ─── Part 5 — Corpus Registry ───────────────────────────────────────────────
  describe("Corpus Registry (declarativo, append-only)", () => {
    it("constrói registro, registra corpus e consulta por tipo", () => {
      const federal = corpus({ name: "Federal", type: "federal" });
      const estadual = corpus({ name: "Estadual", type: "estadual" });
      let reg = buildCorpusRegistry(ORG, "Corpus Registry", [federal]);
      expect(reg.entries).toHaveLength(1);
      reg = registerCorpus(reg, estadual);
      expect(reg.entries).toHaveLength(2);
      reg = registerCorpus(reg, estadual); // idempotente
      expect(reg.entries).toHaveLength(2);
      expect(findRegistryEntry(reg, federal.id)!.type).toBe("federal");
      expect(registryByType(reg, "estadual")).toHaveLength(1);
    });
  });

  // ─── Part 6 — Legal Knowledge Integration ───────────────────────────────────
  describe("Legal Knowledge Integration (unidade pertence a um corpus, nunca ao sistema)", () => {
    it("vincula LegalKnowledgeUnit preservando versionamento/replay/explicação", () => {
      const c = corpus({ status: "active" });
      const col = createKnowledgeCollection({ tenantId: ORG, corpusId: c.id, name: "Col", createdAt: T });
      const unit = structuralSampleBase(ORG).units.find(u => u.type === "lei")!;
      const { link, collection } = attachLegalKnowledge({ corpus: c, collection: col, unit, explanation: "pertence", createdAt: T });
      expect(link.unitId).toBe(unit.id);
      expect(link.unitReplayHash).toBe(unit.replayHash);
      expect(link.unitVersion).toBe(unit.version);
      expect(link.explanation.length).toBeGreaterThan(0);
      expect(collection.members.some(m => m.kind === "legal_unit" && m.refId === unit.id)).toBe(true);
    });
    it("rejeita vínculo cross-tenant (isolamento) e coleção de outro corpus", () => {
      const c = corpus();
      const colOutroCorpus = createKnowledgeCollection({ tenantId: ORG, corpusId: "outro", name: "Col", createdAt: T });
      const unit = structuralSampleBase(ORG).units[0];
      expect(() => attachLegalKnowledge({ corpus: c, collection: colOutroCorpus, unit, explanation: "x" })).toThrow();
      const unitOutroTenant = structuralSampleBase(999).units[0];
      const col = createKnowledgeCollection({ tenantId: ORG, corpusId: c.id, name: "Col", createdAt: T });
      expect(() => attachLegalKnowledge({ corpus: c, collection: col, unit: unitOutroTenant, explanation: "x" })).toThrow();
    });
  });

  // ─── Part 7 — Knowledge Graph Projection ────────────────────────────────────
  describe("Corpus Projection (Corpus/Collection Nodes, Ownership, Hierarchy, Grouping)", () => {
    it("projeta nós e arestas determinísticos", () => {
      const f = structuralSampleFramework(ORG);
      const p = projectCorpusFramework(f);
      expect(p.nodes.filter(n => n.semanticType === "corpus")).toHaveLength(f.corpora.length);
      expect(p.nodes.filter(n => n.semanticType === "collection")).toHaveLength(f.collections.length);
      expect(p.edges.some(e => e.type === "hierarchy")).toBe(true);
      expect(p.edges.some(e => e.type === "owns")).toBe(true);
      expect(p.edges.some(e => e.type === "groups")).toBe(true);
      // grouping de legal_unit alinha com a projeção da Legal Knowledge Foundation (lku:)
      expect(p.edges.some(e => e.type === "groups" && e.to.startsWith("lku:"))).toBe(true);
      expect(projectCorpusFramework(f)).toEqual(p); // determinismo
    });
  });

  // ─── Part 8 — Queries ───────────────────────────────────────────────────────
  describe("Queries (declarativas, sem banco)", () => {
    const f = structuralSampleFramework(ORG);
    const federal = f.corpora.find(c => c.type === "federal")!;
    const estadual = f.corpora.find(c => c.type === "estadual")!;
    it("findCorpus/Collections/KnowledgeByCorpus/ByCollection/Hierarchy/Dependencies/Children/Parents/Metadata", () => {
      expect(findCorpus(f, federal.id)!.type).toBe("federal");
      expect(findCollections(f, federal.id).length).toBeGreaterThan(0);
      expect(findKnowledgeByCorpus(f, federal.id).length).toBeGreaterThan(0);
      const col = findCollections(f, estadual.id)[0];
      expect(findKnowledgeByCollection(f, col.id).length).toBeGreaterThan(0);
      expect(findCorpusParents(f, estadual.id).map(c => c.id)).toContain(federal.id);
      expect(findCorpusChildren(f, federal.id).map(c => c.id)).toContain(estadual.id);
      expect(findCorpusDependencies(f, estadual.id).map(c => c.id)).toContain(federal.id);
      expect(findCorpusHierarchy(f, estadual.id).some(c => c.id === estadual.id)).toBe(true);
      expect(findCorpusMetadata(f, federal.id)!.collections).toBe(1);
    });
  });

  // ─── Part 9 — Versionamento & Lifecycle ─────────────────────────────────────
  describe("Versionamento (append-only) & Lifecycle", () => {
    it("evolveCorpus/activate/deprecate criam nova versão preservando linhagem", () => {
      const v1 = corpus({ status: "draft" });
      const v2 = activateCorpus(v1, T);
      expect(v2.version).toBe(2);
      expect(v2.status).toBe("active");
      expect(v2.lineageId).toBe(v1.lineageId);
      expect(v2.id).not.toBe(v1.id);
      expect(v1.status).toBe("draft"); // imutável
      const v3 = deprecateCorpus(v2, T);
      expect(v3.version).toBe(3);
      expect(v3.status).toBe("deprecated");
      const chain = buildCorpusVersionChains([v1, v2, v3])[0];
      expect(chain.versions.map(v => v.version)).toEqual([1, 2, 3]);
      expect(isCorpusVersionChainConsistent(chain)).toBe(true);
      expect(latestCorpusVersion(chain)!.version).toBe(3);
    });
    it("evolveCorpus com mudança estrutural mantém linhagem", () => {
      const v1 = corpus();
      const v2 = evolveCorpus(v1, { description: "nova descrição" }, T);
      expect(v2.lineageId).toBe(v1.lineageId);
      expect(v2.description).toBe("nova descrição");
    });
  });

  // ─── Part 10 — Explainability ───────────────────────────────────────────────
  describe("Explainability (nunca só dados)", () => {
    it("explica origem/escopo/abrangência/hierarquia/dependências/coleções/versões", () => {
      const f = structuralSampleFramework(ORG);
      const estadual = f.corpora.find(c => c.type === "estadual")!;
      const ex = explainCorpus(f, estadual);
      for (const field of ["origin", "scope", "breadth", "hierarchy", "dependencies", "collections", "attachedKnowledge", "versions", "summary"]) expect(ex, field).toHaveProperty(field);
      expect(ex.origin.type).toBe("estadual");
      expect(ex.dependencies.length).toBeGreaterThan(0);
      expect(ex.collections.length).toBeGreaterThan(0);
      expect(ex.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── Validação ──────────────────────────────────────────────────────────────
  describe("validateCorpusFramework", () => {
    it("framework estrutural válido: zero erros", () => {
      const v = validateCorpusFramework(structuralSampleFramework(ORG));
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("detecta pai inexistente, ciclo, coleção órfã e vínculo cross-tenant", () => {
      const orfa = createKnowledgeCollection({ tenantId: ORG, corpusId: "nao_existe", name: "Órfã", createdAt: T });
      expect(validateCorpusFramework(createCorpusFramework([], [orfa])).valid).toBe(false);
      const a = corpus({ name: "A" });
      const b = corpus({ name: "B", parentId: a.id });
      const aCycle: InstitutionalCorpus = { ...a, parentId: b.id };
      expect(validateCorpusFramework(createCorpusFramework([aCycle, b], [])).errors.some(e => /ciclo/.test(e))).toBe(true);
    });
  });

  // ─── Part 11 — Observabilidade ──────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("registra eventos e recupera por correlationId; multi-tenant", () => {
      clearCorpusEvents();
      recordCorpusEvent({ correlationId: "corr-rc451", tenantId: ORG, type: "corpusCreated", subjectId: "c1", detail: "criado", count: 1 });
      recordCorpusEvent({ correlationId: "corr-rc451", tenantId: ORG, type: "knowledgeAttached", subjectId: "u1", detail: "vinculado", count: 1 });
      const evs = getCorpusEvents("corr-rc451");
      expect(evs.length).toBe(2);
      expect(evs.map(e => e.type)).toEqual(["corpusCreated", "knowledgeAttached"]);
      expect(evs[0].tenantId).toBe(ORG);
      expect(getCorpusEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesmo framework → mesma validação e mesma projeção", () => {
      const f1 = structuralSampleFramework(ORG); const f2 = structuralSampleFramework(ORG);
      expect(validateCorpusFramework(f1)).toEqual(validateCorpusFramework(f2));
      expect(projectCorpusFramework(f1)).toEqual(projectCorpusFramework(f2));
      expect(f1.corpora.map(c => c.replayHash)).toEqual(f2.corpora.map(c => c.replayHash));
    });
  });
});
