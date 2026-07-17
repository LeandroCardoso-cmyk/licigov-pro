/**
 * RC-4.6 — Federal Procurement Corpus Package
 *
 * Valida o PRIMEIRO pacote oficial do sistema — a estrutura instalável do Corpus Federal de
 * Licitações (SEM artigos/incisos/parágrafos/Lei 14.133 detalhada/acórdãos/doutrina/jurisprudência):
 * manifesto, pacote, coleções vazias, registro, validação, projeção KG, consultas, explainability,
 * observabilidade. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import { createCorpusManifest, isValidManifest } from "../../domain/corpus/package/corpusManifest";
import { createCollectionManifest, isValidCollectionManifest } from "../../domain/corpus/package/collectionManifest";
import { createCorpusPackage, verifyPackageIntegrity, transitionLifecycle } from "../../domain/corpus/package/corpusPackage";
import { buildFederalCollections, FEDERAL_COLLECTION_SPECS } from "../../domain/corpus/package/federalCollections";
import { buildFederalProcurementCorpus, FEDERAL_PROCUREMENT_CORPUS_NAME, FEDERAL_PROCUREMENT_CORPUS_VERSION } from "../../domain/corpus/package/federalProcurementCorpus";
import { createCorpusPackageRegistry, registerPackage, findRegistryEntry, registryEntriesByName } from "../../domain/corpus/package/corpusPackageRegistry";
import { validatePackage, isPackageCompatible } from "../../domain/corpus/package/packageValidation";
import { projectCorpusPackage } from "../../domain/corpus/package/packageProjection";
import {
  findPackage, findCollections, findManifest, findDependencies, findCompatibility,
  findVersions, findAuthority, findScope,
} from "../../domain/corpus/package/packageQueries";
import { explainPackage } from "../../domain/corpus/package/packageExplainability";
import { parseVersion, compareVersions, satisfies, isValidVersion } from "../../domain/corpus/package/semver";
import { recordPackageEvent, getPackageEvents, clearPackageEvents } from "../../services/knowledge/corpusPackageObservabilityService";

const ORG = 12800;
const T = "2026-01-01T00:00:00.000Z";
const COMPAT = { platform: "0.12.0", corpusFramework: "1.0.0", schema: "1.0.0" };

describe("RC-4.6 — Federal Procurement Corpus Package", () => {

  // ─── Semver (base determinística) ───────────────────────────────────────────
  describe("Semver mínimo", () => {
    it("parse/compare/satisfies determinísticos", () => {
      expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(parseVersion("x")).toBeNull();
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
      expect(satisfies("1.2.0", ">=1.0.0")).toBe(true);
      expect(satisfies("0.9.0", ">=1.0.0")).toBe(false);
      expect(satisfies("1.0.0", "1.0.0")).toBe(true);
      expect(isValidVersion("1.0")).toBe(false);
    });
  });

  // ─── Part 1 — CorpusManifest ────────────────────────────────────────────────
  describe("CorpusManifest (representa oficialmente um corpus)", () => {
    it("possui todos os campos, é válido e determinístico", () => {
      const m = createCorpusManifest({ tenantId: ORG, name: "X", authority: "Gov", jurisdiction: "federal", scope: "uniao", version: "1.0.0", compatibility: COMPAT, collections: ["c1"] });
      for (const f of ["id", "tenantId", "name", "description", "authority", "jurisdiction", "language", "scope", "version", "compatibility", "dependencies", "collections", "metadata", "replayHash"]) expect(m, f).toHaveProperty(f);
      expect(isValidManifest(m)).toBe(true);
      expect(m.replayHash).toHaveLength(32);
      const m2 = createCorpusManifest({ tenantId: ORG, name: "X", authority: "Gov", jurisdiction: "federal", scope: "uniao", version: "1.0.0", compatibility: COMPAT, collections: ["c1"] });
      expect(m.id).toBe(m2.id);
      expect(m.replayHash).toBe(m2.replayHash);
    });
    it("multi-tenant: mesmo nome/versão em tenants distintos → ids distintos", () => {
      const a = createCorpusManifest({ tenantId: 1, name: "X", authority: "G", jurisdiction: "federal", scope: "uniao", version: "1.0.0", compatibility: COMPAT });
      const b = createCorpusManifest({ tenantId: 2, name: "X", authority: "G", jurisdiction: "federal", scope: "uniao", version: "1.0.0", compatibility: COMPAT });
      expect(a.id).not.toBe(b.id);
    });
  });

  // ─── Part 3 — CollectionManifest ────────────────────────────────────────────
  describe("CollectionManifest (vazia nesta RC)", () => {
    it("cria coleção válida sem conhecimento e determinística", () => {
      const c = createCollectionManifest({ tenantId: ORG, name: "Col", category: "lei", authority: "Gov", version: "1.0.0" });
      expect(isValidCollectionManifest(c)).toBe(true);
      expect(c.knowledgeUnits).toEqual([]);
      expect(c.replayHash).toHaveLength(32);
    });
  });

  // ─── Part 4 — Federal Collections ───────────────────────────────────────────
  describe("Federal Collections (5 coleções oficiais vazias)", () => {
    it("cria Lei 14.133, Decretos, IN SEGES, AGU, TCU — sem conteúdo", () => {
      const cols = buildFederalCollections(ORG);
      expect(cols).toHaveLength(5);
      expect(cols.map(c => c.name)).toEqual(["Lei 14.133", "Decretos", "IN SEGES", "AGU", "TCU"]);
      for (const c of cols) expect(c.knowledgeUnits).toEqual([]);
      expect(FEDERAL_COLLECTION_SPECS).toHaveLength(5);
      // dependentes referenciam a coleção Lei 14.133
      const lei = cols[0];
      for (const c of cols.slice(1)) expect(c.dependencies).toContain(lei.id);
    });
  });

  // ─── Part 2 — CorpusPackage ─────────────────────────────────────────────────
  describe("CorpusPackage (manifest + coleções + integridade + lifecycle)", () => {
    it("monta pacote com checksums/replayHash e integridade verificável", () => {
      const pkg = buildFederalProcurementCorpus(ORG, T);
      expect(pkg.manifest.name).toBe(FEDERAL_PROCUREMENT_CORPUS_NAME);
      expect(pkg.version).toBe(FEDERAL_PROCUREMENT_CORPUS_VERSION);
      expect(pkg.knowledgeUnits).toEqual([]);
      expect(pkg.collections).toHaveLength(5);
      expect(pkg.integrity.checksumAlg).toBe("sha256");
      expect(Object.keys(pkg.integrity.collectionChecksums)).toHaveLength(5);
      expect(pkg.replayHash).toHaveLength(32);
      expect(verifyPackageIntegrity(pkg)).toBe(true);
      // lifecycle append-only
      const activated = transitionLifecycle(pkg, "active");
      expect(activated.lifecycle).toBe("active");
      expect(pkg.lifecycle).toBe("registered");
    });
    it("integridade falha se uma coleção é adulterada", () => {
      const pkg = buildFederalProcurementCorpus(ORG, T);
      const tampered = { ...pkg, collections: pkg.collections.map((c, i) => i === 0 ? { ...c, replayHash: "adulterado" } : c) };
      expect(verifyPackageIntegrity(tampered)).toBe(false);
    });
  });

  // ─── Part 5 — Package Registry ──────────────────────────────────────────────
  describe("CorpusPackageRegistry (declarativo, append-only)", () => {
    it("registra o Federal Procurement Corpus e consulta", () => {
      const pkg = buildFederalProcurementCorpus(ORG, T);
      let reg = createCorpusPackageRegistry(ORG, "Corpus Package Registry");
      expect(reg.entries).toHaveLength(0);
      reg = registerPackage(reg, pkg);
      expect(reg.entries).toHaveLength(1);
      reg = registerPackage(reg, pkg); // idempotente
      expect(reg.entries).toHaveLength(1);
      expect(findRegistryEntry(reg, pkg.id)!.name).toBe(FEDERAL_PROCUREMENT_CORPUS_NAME);
      expect(registryEntriesByName(reg, FEDERAL_PROCUREMENT_CORPUS_NAME)).toHaveLength(1);
    });
    it("rejeita registro cross-tenant", () => {
      const pkg = buildFederalProcurementCorpus(999, T);
      const reg = createCorpusPackageRegistry(ORG, "R");
      expect(() => registerPackage(reg, pkg)).toThrow();
    });
  });

  // ─── Part 6 — Package Validation ────────────────────────────────────────────
  describe("Package Validation (sem instalação)", () => {
    it("pacote federal é válido: zero erros", () => {
      const v = validatePackage(buildFederalProcurementCorpus(ORG, T));
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("detecta versão divergente e coleção não referenciada", () => {
      const pkg = buildFederalProcurementCorpus(ORG, T);
      const badVersion = { ...pkg, version: "9.9.9" };
      expect(validatePackage(badVersion).valid).toBe(false);
      const extra = createCollectionManifest({ tenantId: ORG, name: "Extra", category: "lei", authority: "G", version: "1.0.0" });
      const withOrphan = { ...pkg, collections: [...pkg.collections, extra] };
      expect(validatePackage(withOrphan).errors.some(e => /não referenciada/.test(e))).toBe(true);
    });
    it("compatibilidade: plataforma/framework satisfazem o mínimo", () => {
      const pkg = buildFederalProcurementCorpus(ORG, T);
      expect(isPackageCompatible(pkg, "0.12.1", "1.0.0")).toBe(true);
      expect(isPackageCompatible(pkg, "0.11.0", "1.0.0")).toBe(false);
    });
  });

  // ─── Part 7 — Knowledge Graph Projection ────────────────────────────────────
  describe("Package Projection (Corpus Package, Collection Nodes, Dependencies)", () => {
    it("projeta nós e arestas determinísticos", () => {
      const pkg = buildFederalProcurementCorpus(ORG, T);
      const p = projectCorpusPackage(pkg);
      expect(p.nodes.filter(n => n.semanticType === "corpus_package")).toHaveLength(1);
      expect(p.nodes.filter(n => n.semanticType === "collection")).toHaveLength(5);
      expect(p.edges.filter(e => e.type === "contains")).toHaveLength(5);
      expect(p.edges.some(e => e.type === "depends_on")).toBe(true);
      expect(projectCorpusPackage(pkg)).toEqual(p); // determinismo
    });
  });

  // ─── Part 8 — Queries ───────────────────────────────────────────────────────
  describe("Queries (declarativas)", () => {
    it("findPackage/Collections/Manifest/Dependencies/Compatibility/Versions/Authority/Scope", () => {
      const pkg = buildFederalProcurementCorpus(ORG, T);
      const reg = registerPackage(createCorpusPackageRegistry(ORG, "R"), pkg);
      expect(findPackage([pkg], pkg.id)!.id).toBe(pkg.id);
      expect(findCollections(pkg)).toHaveLength(5);
      expect(findManifest(pkg).name).toBe(FEDERAL_PROCUREMENT_CORPUS_NAME);
      expect(findDependencies(pkg)).toEqual([]);
      expect(findCompatibility(pkg).corpusFramework).toBe("1.0.0");
      expect(findVersions(reg, FEDERAL_PROCUREMENT_CORPUS_NAME)).toEqual(["1.0.0"]);
      expect(findAuthority(pkg)).toBe("Governo Federal");
      expect(findScope(pkg)).toBe("uniao");
    });
  });

  // ─── Part 9 — Explainability ────────────────────────────────────────────────
  describe("Explainability (nunca só dados)", () => {
    it("explica origem/autoridade/versão/escopo/coleções/dependências/compatibilidade", () => {
      const ex = explainPackage(buildFederalProcurementCorpus(ORG, T));
      for (const f of ["origin", "authority", "version", "scope", "collections", "dependencies", "compatibility", "integrity", "summary"]) expect(ex, f).toHaveProperty(f);
      expect(ex.authority).toBe("Governo Federal");
      expect(ex.collections).toHaveLength(5);
      for (const c of ex.collections) expect(c.units).toBe(0);
      expect(ex.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── Part 10 — Observabilidade ──────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("registra eventos e recupera por correlationId; multi-tenant", () => {
      clearPackageEvents();
      recordPackageEvent({ correlationId: "corr-rc46", tenantId: ORG, type: "packageRegistered", subjectId: "p1", detail: "registrado", count: 1 });
      recordPackageEvent({ correlationId: "corr-rc46", tenantId: ORG, type: "manifestValidated", subjectId: "p1", detail: "válido", count: 0 });
      const evs = getPackageEvents("corr-rc46");
      expect(evs.length).toBe(2);
      expect(evs.map(e => e.type)).toEqual(["packageRegistered", "manifestValidated"]);
      expect(evs[0].tenantId).toBe(ORG);
      expect(getPackageEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesmo tenant → mesmo pacote (id/replayHash/checksums) e mesma projeção", () => {
      const a = buildFederalProcurementCorpus(ORG, T);
      const b = buildFederalProcurementCorpus(ORG, T);
      expect(a.id).toBe(b.id);
      expect(a.replayHash).toBe(b.replayHash);
      expect(a.integrity.packageChecksum).toBe(b.integrity.packageChecksum);
      expect(projectCorpusPackage(a)).toEqual(projectCorpusPackage(b));
    });
  });
});
