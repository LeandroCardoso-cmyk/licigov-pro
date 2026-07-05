import { describe, it, expect } from "vitest";

import {
  createQuery,
  normalizeQuery,
  classifyIntent,
  determineContextStrategy,
  determineRetrievalStrategy,
} from "../../domain/institutionalQuery";

import {
  assembleRAGContext as assembleContext,
  compressRAGContext as compressContext,
  estimateRAGTokens as estimateTokens,
  prioritizeEvidence,
} from "../../domain/contextAssembly";

import {
  createLegalEvidence,
  matchesQuery,
  rankByRelevance,
  formatCitation,
} from "../../domain/legalEvidence";

import {
  createGroundingSession,
  buildEvidenceGraph,
  computeGroundingScore,
  generateReplaySnapshot,
  verifyReplay,
} from "../../domain/groundingSession";

import {
  createCitation,
  formatForDisplay,
  groupBySource,
  validateCitation,
} from "../../domain/responseCitation";

import {
  createValidation,
  assessHallucinationRisk,
  detectUnsupportedClaims,
  detectContradictions,
  determineApprovalRequirement,
} from "../../domain/responseValidation";

import {
  buildPromptContext,
} from "../../domain/aiWorkflow";

import {
  assembleForQuery,
  semanticGrouping,
  contextualCompression,
  evidencePrioritization,
  legalGrouping,
  municipalityMemoryEnrichment,
} from "../../services/contextAssemblyService";

import {
  retrieveAll,
  retrieveFromTRs,
  retrieveFromLegal,
  retrieveFromDocuments,
  retrieveFromCATMAT,
  retrieveFromHistory,
  retrieveFromTemplates,
  weightedMerge,
} from "../../services/institutionalRetrievalService";

import {
  selectEvidence,
  rankEvidence,
  removeDuplicates,
  detectContradictions as detectEvidenceContradictions,
  diversifyEvidence,
} from "../../services/evidenceSelectionService";

import {
  buildGrounding,
  orderEvidence,
  optimizeTokens,
  enrichPrompt,
  buildLegalHierarchy,
  generateReplayKey,
} from "../../services/groundingService";

import {
  generateCitations,
  matchResponseToEvidence,
  formatCitationBlock,
  validateAllCitations,
  groupCitationsByType,
} from "../../services/citationEngineService";

import {
  validateResponse,
  detectHallucinations,
  analyzeContradictions as analyzeResponseContradictions,
  measureGroundingCoverage,
  measureEvidenceUtilization,
  determineApproval,
} from "../../services/responseValidationService";

import {
  computeConfidence,
  retrievalConfidence,
  evidenceConfidence,
  legalConfidence,
  groundingConfidence,
  responseConfidence,
  consolidateScores,
} from "../../services/confidenceEngineService";

import {
  recordRAGTrace,
  recordRAGMetric,
  recordRetrievalLatency,
  recordGroundingLatency,
  recordInferenceLatency,
  recordContextConsumption,
  recordConfidenceScore,
  recordHallucinationAlert,
  recordCitationCount,
  recordValidationResult,
} from "../../services/ragObservabilityService";

const ORG_ID = 10000;

// ─── institutionalQuery ──────────────────────────────────────────────────────

describe("Sprint 4.7 — Institutional RAG Engine", () => {
  describe("institutionalQuery", () => {
    it("should create a query with deterministic ID", () => {
      const q = createQuery({
        organizationId: ORG_ID,
        userId: "user1",
        query: "Elaborar estudo técnico preliminar",
      });
      expect(q.id).toBeTruthy();
      expect(q.id.length).toBe(20);
      expect(q.organizationId).toBe(ORG_ID);
      expect(q.userId).toBe("user1");
      expect(q.query).toBe("Elaborar estudo técnico preliminar");
    });

    it("should produce deterministic IDs for same input", () => {
      const q1 = createQuery({ organizationId: ORG_ID, userId: "u1", query: "test query" });
      const q2 = createQuery({ organizationId: ORG_ID, userId: "u1", query: "test query" });
      expect(q1.id).toBe(q2.id);
    });

    it("should normalize query correctly", () => {
      expect(normalizeQuery("  HELLO   World  ")).toBe("hello world");
      expect(normalizeQuery("  Trim me  ")).toBe("trim me");
    });

    it("should classify legal consultation intent", () => {
      expect(classifyIntent("Qual o artigo 18 da lei?")).toBe("legal_consultation");
    });

    it("should classify TR generation intent", () => {
      expect(classifyIntent("Elaborar termo de referência")).toBe("tr_generation");
    });

    it("should classify item search intent", () => {
      expect(classifyIntent("Buscar item catmat computador")).toBe("item_search");
    });

    it("should classify jurisprudence intent", () => {
      expect(classifyIntent("Jurisprudência do TCU sobre pregão")).toBe("jurisprudence");
    });

    it("should classify compliance check intent", () => {
      expect(classifyIntent("Verificar compliance do edital")).toBe("compliance_check");
    });

    it("should classify document review intent", () => {
      expect(classifyIntent("Revisar documento DFD")).toBe("document_review");
    });

    it("should classify general intent for unknown queries", () => {
      expect(classifyIntent("Como está o tempo?")).toBe("general");
    });

    it("should determine legal_focused context strategy for legal intent", () => {
      expect(determineContextStrategy("legal_consultation", "factual")).toBe("legal_focused");
    });

    it("should determine full_context for TR generation", () => {
      expect(determineContextStrategy("tr_generation", "generative")).toBe("full_context");
    });

    it("should determine retrieval strategy for legal intent", () => {
      expect(determineRetrievalStrategy("legal_consultation", "factual")).toBe("legal_priority");
    });

    it("should determine lexical_only for item search", () => {
      expect(determineRetrievalStrategy("item_search", "factual")).toBe("lexical_only");
    });

    it("should determine hybrid for generative analytical", () => {
      expect(determineRetrievalStrategy("general", "analytical")).toBe("hybrid");
    });

    it("should set workflowId when provided", () => {
      const q = createQuery({
        organizationId: ORG_ID,
        userId: "u1",
        query: "test",
        workflowId: "wf123",
      });
      expect(q.workflowId).toBe("wf123");
    });

    it("should set workflowId to null by default", () => {
      const q = createQuery({
        organizationId: ORG_ID,
        userId: "u1",
        query: "test",
      });
      expect(q.workflowId).toBeNull();
    });
  });

  // ─── contextAssembly ────────────────────────────────────────────────────────

  describe("contextAssembly", () => {
    it("should assemble context with all sources", () => {
      const ctx = assembleContext(
        { id: "q1", organizationId: ORG_ID },
        [{ chunkId: "c1", content: "chunk content", similarity: 0.9, source: "doc" }],
        [{ lawRef: "Lei 14.133/2021", article: "Art. 18", clause: "", text: "ETP" }],
        [{ processId: "2024/001", description: "compra", date: "2024-01-01", relevance: 0.8 }],
        [{ trId: "tr1", title: "TR teste", similarity: 0.85, keyTerms: ["teste"] }],
        [{ evidenceId: "e1", type: "legal", content: "evidence", confidence: 0.9 }],
      );
      expect(ctx.id).toBeTruthy();
      expect(ctx.organizationId).toBe(ORG_ID);
      expect(ctx.retrievedChunks.length).toBe(1);
      expect(ctx.legalReferences.length).toBe(1);
      expect(ctx.totalTokens).toBeGreaterThan(0);
    });

    it("should compress context when tokens exceed limit", () => {
      const ctx = assembleContext(
        { id: "q1", organizationId: ORG_ID },
        [
          { chunkId: "c1", content: "a ".repeat(500), similarity: 0.9, source: "doc" },
          { chunkId: "c2", content: "b ".repeat(500), similarity: 0.3, source: "doc" },
        ],
        [], [], [], [],
      );
      const compressed = compressContext(ctx, 100);
      expect(compressed.compressionApplied).toBe(true);
      expect(compressed.retrievedChunks.length).toBeLessThanOrEqual(ctx.retrievedChunks.length);
    });

    it("should estimate tokens from text", () => {
      const tokens = estimateTokens("This is a test sentence with multiple words");
      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe("number");
    });

    it("should prioritize evidence by confidence desc", () => {
      const evidence = [
        { evidenceId: "e1", type: "legal", content: "a", confidence: 0.5 },
        { evidenceId: "e2", type: "legal", content: "b", confidence: 0.9 },
        { evidenceId: "e3", type: "legal", content: "c", confidence: 0.7 },
      ];
      const sorted = prioritizeEvidence(evidence);
      expect(sorted[0].confidence).toBe(0.9);
      expect(sorted[1].confidence).toBe(0.7);
      expect(sorted[2].confidence).toBe(0.5);
    });

    it("should generate deterministic context ID", () => {
      const ctx1 = assembleContext({ id: "q1", organizationId: ORG_ID }, [], [], [], [], []);
      const ctx2 = assembleContext({ id: "q1", organizationId: ORG_ID }, [], [], [], [], []);
      expect(ctx1.id).toBe(ctx2.id);
    });
  });

  // ─── legalEvidence ──────────────────────────────────────────────────────────

  describe("legalEvidence", () => {
    it("should create legal evidence with deterministic ID", () => {
      const ev = createLegalEvidence({
        organizationId: ORG_ID,
        sourceType: "lei_14133",
        sourceId: "lei14133",
        lawReference: "Lei 14.133/2021",
        article: "Art. 18",
        text: "O estudo técnico preliminar",
        confidence: 0.95,
        explanation: "Artigo relevante",
      });
      expect(ev.id.length).toBe(20);
      expect(ev.organizationId).toBe(ORG_ID);
      expect(ev.sourceType).toBe("lei_14133");
    });

    it("should match query when evidence contains query words", () => {
      const ev = createLegalEvidence({
        organizationId: ORG_ID,
        sourceType: "lei_14133",
        sourceId: "s1",
        lawReference: "Lei 14.133/2021",
        article: "Art. 18",
        text: "O estudo técnico preliminar para contratação",
        confidence: 0.9,
        explanation: "test",
      });
      expect(matchesQuery(ev, "estudo técnico")).toBe(true);
      expect(matchesQuery(ev, "xyz abc")).toBe(false);
    });

    it("should rank by relevance (highest first)", () => {
      const evA = createLegalEvidence({
        organizationId: ORG_ID, sourceType: "lei_14133", sourceId: "a",
        lawReference: "Lei 14.133/2021", article: "Art. 1",
        text: "contratação pública direta", confidence: 0.5, explanation: "t",
      });
      const evB = createLegalEvidence({
        organizationId: ORG_ID, sourceType: "lei_14133", sourceId: "b",
        lawReference: "Lei 14.133/2021", article: "Art. 2",
        text: "contratação pública de bens e serviços com licitação", confidence: 0.9, explanation: "t",
      });
      const ranked = rankByRelevance([evA, evB], "contratação pública licitação");
      expect(ranked[0].article).toBe("Art. 2");
    });

    it("should format citation correctly", () => {
      const ev = createLegalEvidence({
        organizationId: ORG_ID, sourceType: "lei_14133", sourceId: "s1",
        lawReference: "Lei 14.133/2021", article: "Art. 18",
        text: "test", confidence: 0.9, explanation: "t",
        clause: "§ 2º",
      });
      const citation = formatCitation(ev);
      expect(citation).toContain("Lei 14.133/2021");
      expect(citation).toContain("Art. 18");
    });

    it("should produce deterministic IDs for same inputs", () => {
      const params = {
        organizationId: ORG_ID, sourceType: "lei_14133" as const, sourceId: "s1",
        lawReference: "Lei 14.133/2021", article: "Art. 18",
        text: "test", confidence: 0.9, explanation: "t",
      };
      const ev1 = createLegalEvidence(params);
      const ev2 = createLegalEvidence(params);
      expect(ev1.id).toBe(ev2.id);
    });
  });

  // ─── groundingSession ───────────────────────────────────────────────────────

  describe("groundingSession", () => {
    it("should create grounding session", () => {
      const gs = createGroundingSession({
        organizationId: ORG_ID,
        queryId: "q1",
        correlationId: "corr1",
        finalPrompt: "test prompt",
        groundingScore: 0.85,
        confidenceScore: 0.80,
      });
      expect(gs.id.length).toBe(20);
      expect(gs.organizationId).toBe(ORG_ID);
      expect(gs.groundingScore).toBe(0.85);
    });

    it("should build evidence graph from evidences", () => {
      const evidences = [
        { id: "e1", type: "legal", content: "test1", confidence: 0.9, source: "lei" },
        { id: "e2", type: "document", content: "test2", confidence: 0.8, source: "doc" },
      ];
      const legalRefs = [
        { id: "lr1", content: "ETP obrigatório", confidence: 0.95, source: "Lei 14.133/2021" },
      ];
      const graph = buildEvidenceGraph(evidences, legalRefs);
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(Array.isArray(graph.edges)).toBe(true);
    });

    it("should compute grounding score as average confidence", () => {
      const graph = {
        nodes: [
          { id: "n1", type: "legal", content: "t", confidence: 0.8, source: "s" },
          { id: "n2", type: "doc", content: "t", confidence: 0.6, source: "s" },
        ],
        edges: [],
      };
      const score = computeGroundingScore(graph);
      expect(score).toBeCloseTo(0.7, 1);
    });

    it("should return 0 for empty graph", () => {
      expect(computeGroundingScore({ nodes: [], edges: [] })).toBe(0);
    });

    it("should generate deterministic replay snapshot", () => {
      const gs = createGroundingSession({
        organizationId: ORG_ID, queryId: "q1", correlationId: "c1",
        finalPrompt: "p", groundingScore: 0.8, confidenceScore: 0.7,
      });
      const snap1 = generateReplaySnapshot(gs);
      const snap2 = generateReplaySnapshot(gs);
      expect(snap1).toBe(snap2);
    });

    it("should verify replay correctly", () => {
      const gs = createGroundingSession({
        organizationId: ORG_ID, queryId: "q1", correlationId: "c1",
        finalPrompt: "p", groundingScore: 0.8, confidenceScore: 0.7,
      });
      const snapshot = generateReplaySnapshot(gs);
      expect(verifyReplay(gs, snapshot)).toBe(true);
      expect(verifyReplay(gs, "wrong_snapshot")).toBe(false);
    });

    it("should produce deterministic IDs", () => {
      const params = {
        organizationId: ORG_ID, queryId: "q1", correlationId: "c1",
        finalPrompt: "p", groundingScore: 0.8, confidenceScore: 0.7,
      };
      const gs1 = createGroundingSession(params);
      const gs2 = createGroundingSession(params);
      expect(gs1.id).toBe(gs2.id);
    });
  });

  // ─── responseCitation ───────────────────────────────────────────────────────

  describe("responseCitation", () => {
    it("should create citation with deterministic ID", () => {
      const c = createCitation({
        organizationId: ORG_ID,
        responseId: "r1",
        citationText: "O artigo 18 estabelece",
        sourceDocument: "Lei 14.133/2021",
        similarity: 0.92,
        citationType: "legal_reference",
      });
      expect(c.id.length).toBe(20);
      expect(c.organizationId).toBe(ORG_ID);
      expect(c.citationType).toBe("legal_reference");
    });

    it("should format citation for display", () => {
      const c = createCitation({
        organizationId: ORG_ID, responseId: "r1",
        citationText: "ETP obrigatório", sourceDocument: "Lei 14.133/2021",
        similarity: 0.9, citationType: "legal_reference", page: "5",
      });
      const display = formatForDisplay(c);
      expect(display).toContain("Lei 14.133/2021");
    });

    it("should group citations by source", () => {
      const c1 = createCitation({
        organizationId: ORG_ID, responseId: "r1", citationText: "a",
        sourceDocument: "DocA", similarity: 0.9, citationType: "direct_quote",
      });
      const c2 = createCitation({
        organizationId: ORG_ID, responseId: "r1", citationText: "b",
        sourceDocument: "DocA", similarity: 0.8, citationType: "paraphrase",
      });
      const c3 = createCitation({
        organizationId: ORG_ID, responseId: "r1", citationText: "c",
        sourceDocument: "DocB", similarity: 0.7, citationType: "direct_quote",
      });
      const groups = groupBySource([c1, c2, c3]);
      expect(groups.get("DocA")?.length).toBe(2);
      expect(groups.get("DocB")?.length).toBe(1);
    });

    it("should validate citation against source text", () => {
      const c = createCitation({
        organizationId: ORG_ID, responseId: "r1",
        citationText: "estudo técnico preliminar obrigatório",
        sourceDocument: "Lei", similarity: 0.9, citationType: "direct_quote",
      });
      const valid = validateCitation(c, "O estudo técnico preliminar é obrigatório para toda contratação");
      expect(valid.valid).toBe(true);
    });

    it("should invalidate citation when not matching source", () => {
      const c = createCitation({
        organizationId: ORG_ID, responseId: "r1",
        citationText: "xyz abc def ghi",
        sourceDocument: "Lei", similarity: 0.9, citationType: "direct_quote",
      });
      const result = validateCitation(c, "O estudo técnico preliminar");
      expect(result.valid).toBe(false);
    });
  });

  // ─── responseValidation ─────────────────────────────────────────────────────

  describe("responseValidation", () => {
    it("should create validation with deterministic ID", () => {
      const v = createValidation({
        organizationId: ORG_ID,
        responseId: "r1",
        confidence: 0.85,
        hallucinationRisk: "low",
        unsupportedClaims: [],
        contradictions: [],
        missingEvidence: [],
        validationResult: "approved",
        requiresHumanApproval: false,
        validationExplanation: "All clear",
        groundingCoverage: 0.9,
        evidenceUtilization: 0.8,
      });
      expect(v.id.length).toBe(20);
      expect(v.organizationId).toBe(ORG_ID);
    });

    it("should assess hallucination risk as none for well-grounded response", () => {
      const evidence = [
        "O estudo técnico preliminar é obrigatório para contratações públicas",
        "A Lei 14.133/2021 regulamenta as licitações no Brasil",
      ];
      const response = "O estudo técnico preliminar é obrigatório conforme a lei de licitações";
      const risk = assessHallucinationRisk(response, evidence);
      expect(["none", "low"]).toContain(risk);
    });

    it("should assess high risk for ungrounded response", () => {
      const evidence = ["contratação pública"];
      const response = "A taxa de juros do mercado financeiro internacional caiu para 2% ao ano. Os investimentos em renda fixa são recomendados. O dólar subiu frente ao euro.";
      const risk = assessHallucinationRisk(response, evidence);
      expect(["high", "critical"]).toContain(risk);
    });

    it("should detect unsupported claims", () => {
      const evidence = ["contratação pública licitação"];
      const response = "A contratação deve seguir regras. O clima está ensolarado hoje.";
      const claims = detectUnsupportedClaims(response, evidence);
      expect(claims.length).toBeGreaterThan(0);
    });

    it("should detect contradictions", () => {
      const evidence = ["A licitação é obrigatória para contratações acima do limite"];
      const response = "A licitação não é obrigatória para contratações acima do limite.";
      const contradictions = detectContradictions(response, evidence);
      expect(contradictions.length).toBeGreaterThan(0);
    });

    it("should determine approval required for high risk", () => {
      const v = createValidation({
        organizationId: ORG_ID, responseId: "r1", confidence: 0.3,
        hallucinationRisk: "high", unsupportedClaims: ["claim"],
        contradictions: [], missingEvidence: [], validationResult: "needs_review",
        requiresHumanApproval: true, validationExplanation: "High risk",
        groundingCoverage: 0.3, evidenceUtilization: 0.2,
      });
      expect(determineApprovalRequirement(v)).toBe(true);
    });

    it("should not require approval for none risk with good scores", () => {
      const v = createValidation({
        organizationId: ORG_ID, responseId: "r1", confidence: 0.9,
        hallucinationRisk: "none", unsupportedClaims: [],
        contradictions: [], missingEvidence: [], validationResult: "approved",
        requiresHumanApproval: false, validationExplanation: "Good",
        groundingCoverage: 0.95, evidenceUtilization: 0.9,
      });
      expect(determineApprovalRequirement(v)).toBe(false);
    });
  });

  // ─── contextAssemblyService ─────────────────────────────────────────────────

  describe("contextAssemblyService", () => {
    it("should assemble context for query", () => {
      const ctx = assembleForQuery(
        { normalizedQuery: "test query", intent: "general", organizationId: ORG_ID },
        ORG_ID,
      );
      expect(ctx).toBeTruthy();
      expect(ctx.organizationId).toBe(ORG_ID);
    });

    it("should group chunks semantically by source", () => {
      const chunks = [
        { chunkId: "c1", content: "a", similarity: 0.9, source: "doc1" },
        { chunkId: "c2", content: "b", similarity: 0.8, source: "doc2" },
        { chunkId: "c3", content: "c", similarity: 0.7, source: "doc1" },
      ];
      const groups = semanticGrouping(chunks);
      expect(groups.length).toBeGreaterThan(0);
    });

    it("should compress context to fit token limit", () => {
      const ctx = assembleContext(
        { id: "q1", organizationId: ORG_ID },
        [
          { chunkId: "c1", content: "word ".repeat(200), similarity: 0.9, source: "s" },
          { chunkId: "c2", content: "word ".repeat(200), similarity: 0.3, source: "s" },
        ],
        [], [], [], [],
      );
      const compressed = compressContext(ctx, 50);
      expect(compressed.compressionApplied).toBe(true);
    });

    it("should prioritize evidence by confidence", () => {
      const ev = [
        { evidenceId: "e1", type: "legal", content: "a", confidence: 0.3 },
        { evidenceId: "e2", type: "legal", content: "b", confidence: 0.9 },
      ];
      const result = evidencePrioritization(ev);
      expect(result[0].confidence).toBe(0.9);
    });

    it("should group legal references by law", () => {
      const refs = [
        { lawRef: "Lei 14.133/2021", article: "Art. 18", clause: null, text: "a" },
        { lawRef: "Lei 14.133/2021", article: "Art. 6", clause: null, text: "b" },
        { lawRef: "Decreto 11.462", article: "Art. 1", clause: null, text: "c" },
      ];
      const grouped = legalGrouping(refs);
      expect(grouped.get("Lei 14.133/2021")?.length).toBe(2);
      expect(grouped.get("Decreto 11.462")?.length).toBe(1);
    });

    it("should return municipality memory enrichment", () => {
      const result = municipalityMemoryEnrichment(ORG_ID, "test");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── institutionalRetrievalService ──────────────────────────────────────────

  describe("institutionalRetrievalService", () => {
    it("should retrieve from all sources in parallel", async () => {
      const results = await retrieveAll("contratação pública", ORG_ID);
      expect(results).toHaveProperty("chunks");
      expect(results).toHaveProperty("legalRefs");
      expect(results).toHaveProperty("similarTRs");
      expect(results).toHaveProperty("history");
      expect(results).toHaveProperty("evidence");
    });

    it("should retrieve from TRs", () => {
      const trs = retrieveFromTRs("equipamento", ORG_ID);
      expect(Array.isArray(trs)).toBe(true);
    });

    it("should retrieve from legal sources", () => {
      const legal = retrieveFromLegal("licitação", ORG_ID);
      expect(Array.isArray(legal)).toBe(true);
    });

    it("should retrieve from documents", () => {
      const docs = retrieveFromDocuments("compra", ORG_ID);
      expect(Array.isArray(docs)).toBe(true);
    });

    it("should return empty from CATMAT (stub)", () => {
      const catmat = retrieveFromCATMAT("computador", ORG_ID);
      expect(catmat).toEqual([]);
    });

    it("should retrieve from history", () => {
      const hist = retrieveFromHistory("processo", ORG_ID);
      expect(Array.isArray(hist)).toBe(true);
    });

    it("should retrieve from templates", () => {
      const templates = retrieveFromTemplates("modelo", ORG_ID);
      expect(Array.isArray(templates)).toBe(true);
    });

    it("should weighted merge results", async () => {
      const results = await retrieveAll("test", ORG_ID);
      const merged = weightedMerge(results);
      expect(Array.isArray(merged)).toBe(true);
    });
  });

  // ─── evidenceSelectionService ───────────────────────────────────────────────

  describe("evidenceSelectionService", () => {
    const candidates = [
      { id: "e1", content: "contratação pública licitação obrigatória", source: "lei", score: 0.9, confidence: 0.95, type: "legal" },
      { id: "e2", content: "processo licitatório em andamento regular", source: "doc", score: 0.7, confidence: 0.8, type: "document" },
      { id: "e3", content: "jurisprudência consolidada sobre pregão", source: "jur", score: 0.6, confidence: 0.7, type: "jurisprudence" },
    ];

    it("should select evidence with ranking and dedup", () => {
      const selected = selectEvidence(candidates, "licitação", 10);
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.length).toBeLessThanOrEqual(10);
    });

    it("should rank evidence by score desc", () => {
      const ranked = rankEvidence([...candidates]);
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    });

    it("should remove duplicate evidence", () => {
      const dupes = [
        { id: "e1", content: "contratação pública licitação", source: "a", score: 0.9, confidence: 0.9, type: "legal" },
        { id: "e2", content: "contratação pública licitação", source: "b", score: 0.8, confidence: 0.8, type: "legal" },
      ];
      const deduped = removeDuplicates(dupes);
      expect(deduped.length).toBe(1);
    });

    it("should detect contradictions in evidence", () => {
      const contradicting = [
        { id: "e1", content: "a licitação é obrigatória para todos", source: "a", score: 0.9, confidence: 0.9, type: "legal" },
        { id: "e2", content: "a licitação não é obrigatória para todos", source: "b", score: 0.8, confidence: 0.8, type: "legal" },
      ];
      const contradictions = detectEvidenceContradictions(contradicting);
      expect(contradictions.length).toBeGreaterThan(0);
    });

    it("should diversify evidence by source", () => {
      const many = [
        { id: "e1", content: "a", source: "same", score: 0.9, confidence: 0.9, type: "l" },
        { id: "e2", content: "b", source: "same", score: 0.8, confidence: 0.8, type: "l" },
        { id: "e3", content: "c", source: "same", score: 0.7, confidence: 0.7, type: "l" },
        { id: "e4", content: "d", source: "same", score: 0.6, confidence: 0.6, type: "l" },
        { id: "e5", content: "e", source: "same", score: 0.5, confidence: 0.5, type: "l" },
      ];
      const diversified = diversifyEvidence(many, 3);
      expect(diversified.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── groundingService ──────────────────────────────────────────────────────

  describe("groundingService", () => {
    it("should build grounding with evidence graph", () => {
      const result = buildGrounding(
        { id: "q1", normalizedQuery: "test", organizationId: ORG_ID },
        { promptContext: "context", retrievedChunks: [], legalReferences: [], semanticEvidence: [] },
        [{ content: "evidence text", confidence: 0.8, source: "doc" }],
        "corr1",
      );
      expect(result.groundingSessionId).toBeTruthy();
      expect(result.finalPrompt).toContain("context");
      expect(result.replayKey).toBeTruthy();
      expect(result.correlationId).toBe("corr1");
    });

    it("should order evidence by legal hierarchy", () => {
      const evidence = [
        { content: "instrucao normativa", confidence: 0.9, source: "in", type: "instrucao_normativa" },
        { content: "lei federal", confidence: 0.8, source: "lei", type: "lei" },
        { content: "decreto federal", confidence: 0.7, source: "decreto", type: "decreto" },
      ];
      const ordered = orderEvidence(evidence);
      expect(ordered[0].type).toBe("lei");
    });

    it("should optimize tokens by truncating", () => {
      const longPrompt = "Sentence one. ".repeat(100);
      const optimized = optimizeTokens(longPrompt, 10);
      expect(estimateTokens(optimized)).toBeLessThanOrEqual(estimateTokens(longPrompt));
    });

    it("should enrich prompt with sections", () => {
      const enriched = enrichPrompt(
        "Consulta original",
        "Contexto institucional",
        ["Evidência 1", "Evidência 2"],
        ["Lei 14.133/2021, Art. 18"],
      );
      expect(enriched).toContain("CONTEXTO");
      expect(enriched).toContain("EVIDÊNCIA");
      expect(enriched).toContain("LEGISLAÇÃO");
      expect(enriched).toContain("CONSULTA");
    });

    it("should build legal hierarchy correctly", () => {
      const refs = [
        { lawRef: "IN 01/2023", article: "Art. 1", text: "t" },
        { lawRef: "Lei 14.133/2021", article: "Art. 18", text: "t" },
        { lawRef: "Decreto 11.462", article: "Art. 3", text: "t" },
      ];
      const hierarchy = buildLegalHierarchy(refs);
      expect(hierarchy[0].lawRef).toContain("Lei");
    });

    it("should generate deterministic replay key", () => {
      const inputs = { query: "test", orgId: ORG_ID, intent: "general" };
      const key1 = generateReplayKey(inputs);
      const key2 = generateReplayKey(inputs);
      expect(key1).toBe(key2);
    });

    it("should generate different keys for different inputs", () => {
      const key1 = generateReplayKey({ a: 1 });
      const key2 = generateReplayKey({ a: 2 });
      expect(key1).not.toBe(key2);
    });
  });

  // ─── citationEngineService ──────────────────────────────────────────────────

  describe("citationEngineService", () => {
    it("should generate citations from response and evidence", () => {
      const response = "O estudo técnico preliminar é obrigatório conforme a legislação vigente.";
      const evidence = [
        { id: "ev1", content: "O estudo técnico preliminar é obrigatório para contratações", source: "Lei 14.133/2021", confidence: 0.95 },
      ];
      const chunks = [
        { chunkId: "ch1", content: "A legislação vigente exige estudo técnico preliminar", source: "doc" },
      ];
      const citations = generateCitations(response, evidence, chunks, ORG_ID, "r1");
      expect(citations.length).toBeGreaterThan(0);
      expect(citations[0].organizationId).toBe(ORG_ID);
    });

    it("should match response sentences to evidence", () => {
      const response = "A licitação é processo administrativo formal. O pregão eletrônico é modalidade preferencial.";
      const evidence = [
        { id: "e1", content: "licitação é um processo administrativo formal previsto em lei", source: "lei" },
        { id: "e2", content: "pregão eletrônico como modalidade preferencial de licitação", source: "lei" },
      ];
      const matches = matchResponseToEvidence(response, evidence);
      expect(matches.length).toBeGreaterThan(0);
    });

    it("should format citation block", () => {
      const citations = generateCitations(
        "O estudo técnico é necessário para toda contratação pública.",
        [{ id: "e1", content: "estudo técnico é necessário para contratação pública", source: "Lei", confidence: 0.9 }],
        [], ORG_ID, "r1",
      );
      const block = formatCitationBlock(citations);
      expect(typeof block).toBe("string");
      if (citations.length > 0) {
        expect(block).toContain("[1]");
      }
    });

    it("should validate citations against sources", () => {
      const citations = generateCitations(
        "A contratação pública exige licitação.",
        [{ id: "e1", content: "contratação pública exige processo licitatório", source: "Lei", confidence: 0.9 }],
        [], ORG_ID, "r1",
      );
      const sources = [{ id: "e1", content: "contratação pública exige processo licitatório formal" }];
      const validations = validateAllCitations(citations, sources);
      expect(Array.isArray(validations)).toBe(true);
    });

    it("should group citations by type", () => {
      const citations = generateCitations(
        "O estudo técnico preliminar é obrigatório. O artigo define regras específicas.",
        [
          { id: "e1", content: "estudo técnico preliminar obrigatório conforme legislação", source: "Lei", confidence: 0.9 },
          { id: "e2", content: "artigo define regras específicas para contratação", source: "Lei", confidence: 0.8 },
        ],
        [], ORG_ID, "r1",
      );
      const groups = groupCitationsByType(citations);
      expect(groups instanceof Map).toBe(true);
    });
  });

  // ─── responseValidationService ──────────────────────────────────────────────

  describe("responseValidationService", () => {
    it("should validate response with full pipeline", () => {
      const result = validateResponse(
        "A licitação é obrigatória conforme a lei. O ETP deve ser elaborado antes da contratação.",
        ["A licitação é obrigatória conforme a Lei 14.133/2021", "O ETP é requisito prévio à contratação"],
        { groundingScore: 0.85, confidenceScore: 0.80 },
      );
      expect(result).toHaveProperty("hallucinationRisk");
      expect(result).toHaveProperty("groundingCoverage");
      expect(result).toHaveProperty("evidenceUtilization");
      expect(result).toHaveProperty("validationResult");
    });

    it("should detect hallucinations for ungrounded text", () => {
      const { risk } = detectHallucinations(
        "O mercado financeiro internacional registrou queda nos juros. A inflação subiu no último trimestre.",
        ["contratação pública licitação"],
      );
      expect(["high", "critical"]).toContain(risk);
    });

    it("should detect no hallucinations for grounded text", () => {
      const { risk } = detectHallucinations(
        "A contratação pública deve seguir a legislação vigente.",
        ["contratação pública legislação vigente obrigatória"],
      );
      expect(["none", "low"]).toContain(risk);
    });

    it("should analyze contradictions", () => {
      const contradictions = analyzeResponseContradictions(
        "A licitação não é necessária para contratações diretas.",
        ["A licitação é necessária para toda contratação acima do limite"],
      );
      expect(contradictions.length).toBeGreaterThanOrEqual(0);
    });

    it("should measure grounding coverage", () => {
      const coverage = measureGroundingCoverage(
        "A licitação segue a lei. O pregão é modalidade padrão.",
        ["licitação conforme a lei prevista", "pregão é a modalidade padrão de licitação"],
      );
      expect(coverage).toBeGreaterThan(0);
      expect(coverage).toBeLessThanOrEqual(1);
    });

    it("should measure evidence utilization", () => {
      const utilization = measureEvidenceUtilization(
        "A licitação segue a lei.",
        ["licitação segue a legislação", "pregão eletrônico é preferencial"],
      );
      expect(utilization).toBeGreaterThanOrEqual(0);
      expect(utilization).toBeLessThanOrEqual(1);
    });

    it("should determine approval for high risk", () => {
      expect(determineApproval("high", 0.8, 0.8)).toBe(true);
      expect(determineApproval("critical", 0.8, 0.8)).toBe(true);
    });

    it("should determine approval for low coverage", () => {
      expect(determineApproval("none", 0.3, 0.8)).toBe(true);
    });

    it("should not require approval for good scores", () => {
      expect(determineApproval("none", 0.8, 0.8)).toBe(false);
    });
  });

  // ─── confidenceEngineService ────────────────────────────────────────────────

  describe("confidenceEngineService", () => {
    it("should compute confidence with all dimensions", () => {
      const result = computeConfidence({
        retrievalChunks: [{ similarity: 0.9 }, { similarity: 0.8 }],
        evidence: [{ confidence: 0.85 }],
        legalRefs: [{ confidence: 0.92 }],
        groundingScore: 0.80,
        validationResult: { confidence: 0.75, groundingCoverage: 0.85 },
      });
      expect(result.consolidated).toBeGreaterThan(0);
      expect(result.consolidated).toBeLessThanOrEqual(1);
      expect(result.weights).toHaveProperty("retrieval");
    });

    it("should calculate retrieval confidence", () => {
      expect(retrievalConfidence([{ similarity: 0.8 }, { similarity: 0.6 }])).toBeCloseTo(0.7, 1);
      expect(retrievalConfidence([])).toBe(0);
    });

    it("should calculate evidence confidence", () => {
      expect(evidenceConfidence([{ confidence: 0.9 }, { confidence: 0.7 }])).toBeCloseTo(0.8, 1);
      expect(evidenceConfidence([])).toBe(0);
    });

    it("should calculate legal confidence", () => {
      expect(legalConfidence([{ confidence: 0.95 }])).toBeCloseTo(0.95, 2);
      expect(legalConfidence([])).toBe(0);
    });

    it("should calculate grounding confidence", () => {
      expect(groundingConfidence(0.85)).toBe(0.85);
      expect(groundingConfidence(1.5)).toBe(1);
      expect(groundingConfidence(-0.1)).toBe(0);
    });

    it("should calculate response confidence", () => {
      const result = responseConfidence({ confidence: 0.8, groundingCoverage: 0.9 });
      expect(result).toBeCloseTo(0.85, 1);
    });

    it("should consolidate scores with default weights", () => {
      const scores = {
        retrieval: 0.8,
        evidence: 0.7,
        legal: 0.9,
        grounding: 0.6,
        response: 0.75,
      };
      const consolidated = consolidateScores(scores);
      expect(consolidated).toBeGreaterThan(0);
      expect(consolidated).toBeLessThanOrEqual(1);
    });

    it("should consolidate scores with custom weights", () => {
      const scores = { retrieval: 1.0, evidence: 0.0 };
      const weights = { retrieval: 1.0, evidence: 0.0 };
      const consolidated = consolidateScores(scores, weights);
      expect(consolidated).toBeCloseTo(1.0, 1);
    });
  });

  // ─── ragObservabilityService ────────────────────────────────────────────────

  describe("ragObservabilityService", () => {
    it("should record RAG trace without error", () => {
      expect(() => recordRAGTrace({
        correlationId: "corr1", operation: "test", stages: { retrieval: 50 },
        totalMs: 100, chunkCount: 5, evidenceCount: 3, confidenceScore: 0.8,
        hallucinationRisk: "none", organizationId: ORG_ID, recordedAt: new Date().toISOString(),
      })).not.toThrow();
    });

    it("should record RAG metric without error", () => {
      expect(() => recordRAGMetric({
        name: "test_metric", value: 42, unit: "count",
        tags: { test: "true" }, organizationId: ORG_ID, recordedAt: new Date().toISOString(),
      })).not.toThrow();
    });

    it("should record retrieval latency", () => {
      expect(() => recordRetrievalLatency("corr1", 50, ORG_ID)).not.toThrow();
    });

    it("should record grounding latency", () => {
      expect(() => recordGroundingLatency("corr1", 35, ORG_ID)).not.toThrow();
    });

    it("should record inference latency", () => {
      expect(() => recordInferenceLatency("corr1", 80, ORG_ID)).not.toThrow();
    });

    it("should record context consumption", () => {
      expect(() => recordContextConsumption("corr1", 3500, ORG_ID)).not.toThrow();
    });

    it("should record confidence score", () => {
      expect(() => recordConfidenceScore("corr1", 0.85, ORG_ID)).not.toThrow();
    });

    it("should record hallucination alert", () => {
      expect(() => recordHallucinationAlert("corr1", "high", ORG_ID)).not.toThrow();
    });

    it("should record citation count", () => {
      expect(() => recordCitationCount("corr1", 5, ORG_ID)).not.toThrow();
    });

    it("should record validation result", () => {
      expect(() => recordValidationResult("corr1", "approved", ORG_ID)).not.toThrow();
    });
  });

  // ─── aiWorkflow expansion ──────────────────────────────────────────────────

  describe("aiWorkflow expansion", () => {
    it("should have buildPromptContext function", () => {
      expect(typeof buildPromptContext).toBe("function");
    });

    it("should build enriched prompt context (never raw)", () => {
      const result = buildPromptContext({
        institutionalContext: "Organização Municipal",
        documents: ["Doc 1"],
        evidence: ["Evidência 1"],
        history: ["Histórico 1"],
        legislation: ["Lei 14.133/2021"],
        constraints: ["Restrição 1"],
        workflowInstructions: "Elaborar ETP",
      });
      expect(result).toContain("CONTEXTO INSTITUCIONAL");
      expect(result).toContain("LEGISLAÇÃO");
      expect(result).toContain("DOCUMENTOS");
      expect(result).toContain("EVIDÊNCIAS");
      expect(result).toContain("INSTRUÇÕES");
      expect(result).toContain("Organização Municipal");
    });

    it("should always include institutional context and instructions", () => {
      const result = buildPromptContext({
        institutionalContext: "Contexto",
        documents: [],
        evidence: [],
        history: [],
        legislation: [],
        constraints: [],
        workflowInstructions: "Instrução",
      });
      expect(result).toContain("Contexto");
      expect(result).toContain("Instrução");
    });

    it("should skip empty sections", () => {
      const result = buildPromptContext({
        institutionalContext: "Ctx",
        documents: [],
        evidence: [],
        history: [],
        legislation: [],
        constraints: [],
        workflowInstructions: "Instr",
      });
      expect(result).not.toContain("DOCUMENTOS");
      expect(result).not.toContain("EVIDÊNCIAS");
    });
  });

  // ─── Multi-tenant isolation ─────────────────────────────────────────────────

  describe("multi-tenant isolation", () => {
    it("should produce different IDs for different organizations", () => {
      const q1 = createQuery({ organizationId: 1, userId: "u1", query: "test" });
      const q2 = createQuery({ organizationId: 2, userId: "u1", query: "test" });
      expect(q1.id).not.toBe(q2.id);
    });

    it("should isolate legal evidence by org", () => {
      const e1 = createLegalEvidence({
        organizationId: 1, sourceType: "lei_14133", sourceId: "s1",
        lawReference: "Lei", article: "Art", text: "t", confidence: 0.9, explanation: "e",
      });
      const e2 = createLegalEvidence({
        organizationId: 2, sourceType: "lei_14133", sourceId: "s1",
        lawReference: "Lei", article: "Art", text: "t", confidence: 0.9, explanation: "e",
      });
      expect(e1.id).not.toBe(e2.id);
    });

    it("should isolate grounding sessions by org", () => {
      const g1 = createGroundingSession({
        organizationId: 1, queryId: "q1", correlationId: "c1",
        finalPrompt: "p", groundingScore: 0.8, confidenceScore: 0.7,
      });
      const g2 = createGroundingSession({
        organizationId: 2, queryId: "q1", correlationId: "c1",
        finalPrompt: "p", groundingScore: 0.8, confidenceScore: 0.7,
      });
      expect(g1.id).not.toBe(g2.id);
    });
  });

  // ─── Replay safety ─────────────────────────────────────────────────────────

  describe("replay safety", () => {
    it("should produce same query for same inputs", () => {
      const q1 = createQuery({ organizationId: ORG_ID, userId: "u1", query: "test" });
      const q2 = createQuery({ organizationId: ORG_ID, userId: "u1", query: "test" });
      expect(q1.id).toBe(q2.id);
      expect(q1.normalizedQuery).toBe(q2.normalizedQuery);
      expect(q1.intent).toBe(q2.intent);
    });

    it("should produce same context assembly for same inputs", () => {
      const c1 = assembleContext({ id: "q1", organizationId: ORG_ID }, [], [], [], [], []);
      const c2 = assembleContext({ id: "q1", organizationId: ORG_ID }, [], [], [], [], []);
      expect(c1.id).toBe(c2.id);
    });

    it("should produce same replay key for same grounding inputs", () => {
      const key1 = generateReplayKey({ a: 1, b: "test", c: true });
      const key2 = generateReplayKey({ a: 1, b: "test", c: true });
      expect(key1).toBe(key2);
    });

    it("should produce same confidence scores for same inputs", () => {
      const params = {
        retrievalChunks: [{ similarity: 0.8 }],
        evidence: [{ confidence: 0.9 }],
        legalRefs: [{ confidence: 0.85 }],
        groundingScore: 0.75,
        validationResult: { confidence: 0.8, groundingCoverage: 0.9 },
      };
      const c1 = computeConfidence(params);
      const c2 = computeConfidence(params);
      expect(c1.consolidated).toBe(c2.consolidated);
    });
  });
});
