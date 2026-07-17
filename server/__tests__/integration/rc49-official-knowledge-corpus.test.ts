/**
 * RC-4.9 — Official Knowledge Corpus (Federal + Paraná + Moreira Sales)
 *
 * Valida a incorporação do PRIMEIRO corpus oficial do sistema com documentos REAIS (texto oficial
 * verbatim em `data/`), usando exclusivamente a infraestrutura cognitiva já existente. SEM RAG/IA/
 * chat: cadastro federal/estadual/municipal, hierarquia, resolução por tenant, versionamento,
 * publication pipeline, quality gates, explainability. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseOfficialText, chunkText } from "../../services/officialCorpus/officialTextParser";
import { buildOfficialKnowledgeCorpus, MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import { ingestNorm } from "../../domain/officialCorpus/officialCorpusIngestion";
import { classifyOfficialDocument, isValidOfficialDocument } from "../../domain/officialCorpus/officialDocument";
import {
  findByEsfera, findByAuthority, findByState, findByType, findVigentes, findByTenant, resolveContext, buildOfficialCorpora,
} from "../../domain/officialCorpus/officialCorpusRegistry";
import { explainOfficialDocument } from "../../domain/officialCorpus/officialCorpusExplainability";
import { evaluateQualityGates } from "../../domain/knowledge/pipeline/qualityGates";
import { allBlocks } from "../../domain/knowledge/knowledgeDocument";
import { recordOfficialCorpusEvent, getOfficialCorpusEvents, clearOfficialCorpusEvents } from "../../services/knowledge/officialCorpusObservabilityService";

const ORG = 13500;
const DATA = join(process.cwd(), "data");
// Build once (determinístico) e reutiliza — a incorporação real é pesada.
const RESULT = buildOfficialKnowledgeCorpus({ correlationId: "rc49-suite" });

describe("RC-4.9 — Official Knowledge Corpus", () => {

  // ─── Parser (texto oficial verbatim) ────────────────────────────────────────
  describe("Parser de texto oficial", () => {
    it("parseia a Lei 14.133 real: artigos, títulos, capítulos, parágrafos — verbatim", () => {
      const parsed = parseOfficialText(readFileSync(join(DATA, "lei_14133_2021.txt"), "utf8"));
      expect(parsed.title).toMatch(/14\.133/);
      expect(parsed.articles.length).toBeGreaterThan(190);
      const art1 = parsed.articles[0];
      expect(art1.identifier).toBe("Art. 1º");
      expect(art1.path).toContain("Título I");
      expect(art1.paragraphs.length).toBeGreaterThan(0);
      // verbatim: contém texto oficial real, sem resumo/interpretação
      expect(art1.fullText).toContain("normas gerais de licitação");
      // determinismo
      expect(parseOfficialText(readFileSync(join(DATA, "lei_14133_2021.txt"), "utf8")).articles.length).toBe(parsed.articles.length);
    });
    it("chunkText divide manuais longos deterministicamente", () => {
      const raw = readFileSync(join(DATA, "manual_tce_pr.txt"), "utf8");
      const chunks = chunkText(raw, 12000);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join("").length).toBeGreaterThan(0);
    });
  });

  // ─── Fase 5 — Classificação ─────────────────────────────────────────────────
  describe("Classificação do documento oficial", () => {
    it("cria classificação válida com todos os campos e isolamento municipal", () => {
      const fed = classifyOfficialDocument({ normId: "x", documentType: "lei", authority: "Congresso Nacional", jurisdiction: "federal", source: "planalto", title: "Lei X" });
      for (const f of ["documentId", "documentType", "authority", "jurisdiction", "scope", "tenantId", "state", "municipality", "effectiveDate", "source", "version", "status", "language", "normId", "title", "replayHash"]) expect(fed, f).toHaveProperty(f);
      expect(isValidOfficialDocument(fed)).toBe(true);
      expect(fed.tenantId).toBeNull();
      // municipal exige tenantId + municipality
      const badMun = classifyOfficialDocument({ normId: "y", documentType: "decreto_municipal", authority: "Prefeitura", jurisdiction: "municipal", source: "diario", title: "Dec" });
      expect(isValidOfficialDocument(badMun)).toBe(false);
      const okMun = classifyOfficialDocument({ normId: "y", documentType: "decreto_municipal", authority: "Prefeitura", jurisdiction: "municipal", source: "diario", title: "Dec", tenantId: ORG, municipality: "Moreira Sales", state: "PR" });
      expect(isValidOfficialDocument(okMun)).toBe(true);
    });
  });

  // ─── Fases 1-3 — Cadastro por esfera ────────────────────────────────────────
  describe("Cadastro Federal / Estadual / Municipal", () => {
    it("Federal: Lei 14.133 + regulamentação incorporadas e publicadas", () => {
      expect(RESULT.counts.federal).toBeGreaterThanOrEqual(5);
      const lei = RESULT.ingested.find(d => d.official.normId === "lei-14133-2021")!;
      expect(lei.official.jurisdiction).toBe("federal");
      expect(lei.official.authority).toBe("Congresso Nacional");
      expect(lei.publication.published).toBe(true);
      expect(lei.normativeTree!.nodes.length).toBeGreaterThan(200); // hierarquia real
      expect(findByType(RESULT.registry, "decreto").length).toBeGreaterThan(0);
      expect(findByType(RESULT.registry, "instrucao_normativa").length).toBeGreaterThan(0);
    });
    it("Paraná: TCE-PR incorporado com state=PR", () => {
      expect(RESULT.counts.parana).toBeGreaterThanOrEqual(1);
      const tce = findByState(RESULT.registry, "PR").find(d => d.jurisdiction === "estadual")!;
      expect(tce.authority).toBe("TCE-PR");
      expect(tce.jurisdiction).toBe("estadual");
    });
    it("Moreira Sales: corpus/tenant preparado, ZERO documentos fabricados", () => {
      // corpus municipal existe na hierarquia; nenhum documento municipal (sem fonte oficial)
      expect(RESULT.counts.moreiraSales).toBe(0);
      expect(findByTenant(RESULT.registry, MOREIRA_SALES_TENANT_ID)).toHaveLength(0);
      const corpora = buildOfficialCorpora(MOREIRA_SALES_TENANT_ID);
      expect(corpora.some(c => c.metadata.municipality === "Moreira Sales" && c.tenantId === MOREIRA_SALES_TENANT_ID)).toBe(true);
    });
  });

  // ─── Fase 6 — Hierarquia (Federal → Estado → Município) ─────────────────────
  describe("Hierarquia e resolução por tenant", () => {
    it("corpora formam a cadeia Federal → Paraná → Moreira Sales", () => {
      const [federal, parana, moreira] = buildOfficialCorpora(MOREIRA_SALES_TENANT_ID);
      expect(federal.parentId).toBeNull();
      expect(parana.parentId).toBe(federal.id);
      expect(moreira.parentId).toBe(parana.id);
    });
    it("resolveContext: federal primeiro; municipal complementa, nunca substitui", () => {
      const ctx = resolveContext(RESULT.registry, { state: "PR", tenantId: MOREIRA_SALES_TENANT_ID, municipality: "Moreira Sales" });
      expect(ctx.documents.length).toBeGreaterThan(0);
      expect(ctx.documents[0].jurisdiction).toBe("federal"); // precedência federal
      expect(ctx.order).toEqual(["federal", "estadual", "municipal"]);
      // toda a base federal permanece aplicável (não é substituída)
      expect(ctx.documents.filter(d => d.jurisdiction === "federal").length).toBe(findByEsfera(RESULT.registry, "federal").length);
    });
  });

  // ─── Fases 7 — Pipeline / Quality Gates / Versionamento ─────────────────────
  describe("Publication Pipeline & Quality Gates (perfil oficial)", () => {
    it("todos os documentos passaram pelos 16 estágios e foram publicados", () => {
      for (const d of RESULT.ingested) {
        expect(d.execution.execution.status).toBe("completed");
        expect(d.execution.execution.executedStages).toHaveLength(16);
        expect(d.publication.published).toBe(true);
        expect(d.publication.snapshot!.version.semver).toBe("1.0.0");
      }
    });
    it("gate oficial: OfficialText+Explainability passa; documento sem texto oficial falha", () => {
      const lei = RESULT.ingested.find(d => d.official.normId === "lei-14133-2021")!;
      expect(evaluateQualityGates({ document: lei.knowledgeDocument, profile: "official_norm" }).passed).toBe(true);
      // sem perfil oficial (perfil geral), documento oficial verbatim NÃO teria os blocos recomendados
      expect(evaluateQualityGates({ document: lei.knowledgeDocument, profile: "general" }).passed).toBe(false);
      // documento oficial deve conter blocos OfficialText + Explainability
      const kinds = new Set(allBlocks(lei.knowledgeDocument).map(b => b.kind));
      expect(kinds.has("OfficialText")).toBe(true);
      expect(kinds.has("Explainability")).toBe(true);
      // sem resumos/interpretações: nenhum ExecutiveSummary/PlainLanguage
      expect(kinds.has("ExecutiveSummary")).toBe(false);
      expect(kinds.has("PlainLanguage")).toBe(false);
    });
    it("conteúdo verbatim: o texto do Art. 1º está preservado no bloco oficial", () => {
      const lei = RESULT.ingested.find(d => d.official.normId === "lei-14133-2021")!;
      const art1 = allBlocks(lei.knowledgeDocument).find(b => b.kind === "OfficialText" && b.title === "Art. 1º")!;
      expect(art1.fragments[0].text).toContain("normas gerais de licitação");
    });
  });

  // ─── Fase 8 — Consultas ─────────────────────────────────────────────────────
  describe("Consultas declarativas", () => {
    it("por esfera/autoridade/estado/tipo/vigência/tenant", () => {
      expect(findByEsfera(RESULT.registry, "federal").length).toBeGreaterThanOrEqual(5);
      expect(findByEsfera(RESULT.registry, "estadual").length).toBeGreaterThanOrEqual(1);
      expect(findByAuthority(RESULT.registry, "Congresso Nacional").length).toBeGreaterThanOrEqual(2);
      expect(findByState(RESULT.registry, "PR").length).toBeGreaterThanOrEqual(1);
      expect(findByType(RESULT.registry, "lei").length).toBeGreaterThanOrEqual(1);
      expect(findVigentes(RESULT.registry).length).toBe(RESULT.registry.documents.length);
      expect(findByTenant(RESULT.registry, MOREIRA_SALES_TENANT_ID)).toHaveLength(0);
    });
  });

  // ─── Explainability ─────────────────────────────────────────────────────────
  describe("Explainability", () => {
    it("explica origem/classificação/vigência/pipeline/publicação", () => {
      const lei = RESULT.ingested.find(d => d.official.normId === "lei-14133-2021")!;
      const ex = explainOfficialDocument(lei);
      for (const f of ["origin", "classification", "validity", "pipeline", "publication", "structuralNodes", "summary"]) expect(ex, f).toHaveProperty(f);
      expect(ex.origin.source).toBe("planalto.gov.br");
      expect(ex.pipeline.gatesPassed).toBe(true);
      expect(ex.publication.published).toBe(true);
      expect(ex.structuralNodes).toBeGreaterThan(200);
    });
  });

  // ─── Fase 9 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade (correlationId)", () => {
    it("registra corpusCreated/documentPublished e recupera", () => {
      clearOfficialCorpusEvents();
      recordOfficialCorpusEvent({ correlationId: "corr-rc49", tenantId: null, type: "corpusCreated", subjectId: "c1", detail: "Federal", count: 1 });
      recordOfficialCorpusEvent({ correlationId: "corr-rc49", tenantId: null, type: "documentPublished", subjectId: "d1", detail: "Lei 14.133", count: 1 });
      const evs = getOfficialCorpusEvents("corr-rc49");
      expect(evs.map(e => e.type)).toEqual(["corpusCreated", "documentPublished"]);
      expect(getOfficialCorpusEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesma incorporação → mesmos ids/replayHash", () => {
      const again = buildOfficialKnowledgeCorpus({ correlationId: "rc49-again" });
      expect(again.ingested.map(d => d.official.documentId)).toEqual(RESULT.ingested.map(d => d.official.documentId));
      expect(again.ingested.map(d => d.knowledgeDocument.replayHash)).toEqual(RESULT.ingested.map(d => d.knowledgeDocument.replayHash));
      const smallA = ingestNorm({ parsed: parseOfficialText("LEI Nº 1\n\nArt. 1º Teste."), classification: { normId: "n1", documentType: "lei", authority: "A", jurisdiction: "federal", source: "s" }, correlationId: "c" });
      const smallB = ingestNorm({ parsed: parseOfficialText("LEI Nº 1\n\nArt. 1º Teste."), classification: { normId: "n1", documentType: "lei", authority: "A", jurisdiction: "federal", source: "s" }, correlationId: "c" });
      expect(smallA.official.documentId).toBe(smallB.official.documentId);
    });
  });
});
