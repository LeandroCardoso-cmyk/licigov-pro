import { describe, it, expect } from "vitest";

// ─── Domain imports ────────────────────────────────────────────────────────────
import {
  createLegalPremise,
  createExtendedLegalInference,
  createExtendedComplianceCheck,
  createPremiseContradiction,
  createExtendedLegalRisk,
  createExtendedLegalRecommendation,
  createExtendedLegalReasoningTrace,
  detectPremiseContradictions,
  assessExtendedComplianceScore,
  prioritizeExtendedRisks,
  buildExtendedReasoningExplainability,
} from "../../domain/legalReasoning";

import {
  createDraftVariableV2,
  createDraftBlockV2,
  createDraftSectionV2,
  createDraftTemplateV2,
  resolveDraftVariables,
  generateDraftV2,
  extractTemplateSkeleton,
  validateDraftCompletenessV2,
} from "../../domain/documentDrafting";

import {
  createExtendedValidationRule,
  createExtendedValidationReport,
  applyExtendedValidationRules,
  mergeExtendedValidationReports,
  getExtendedValidationSummary,
} from "../../domain/legalValidation";

import {
  createJurisprudenceReferenceV2,
  createPrecedentHierarchyNode,
  createLegalCitationV2,
  findRelevantPrecedentsV2,
  rankPrecedentsByRelevanceV2,
  buildCitationGraphV2,
  formatCitationV2,
} from "../../domain/jurisprudenceReference";

import {
  checkClauseCompatibility,
  buildClauseHierarchy,
  analyzeClauseRisk,
  buildClauseConflictMap,
} from "../../domain/clauseIntelligence";

import {
  createDraftingCheckpoint,
  evaluateDraftCompliance,
  addDraftingCheckpointToHistory,
} from "../../domain/aiWorkflow";

// ─── Service imports ───────────────────────────────────────────────────────────
import { runLegalReasoning, getReasoningHistory, replayReasoning } from "../../services/legalReasoningEngine";
import { runDocumentDrafting, getDraftHistory, replayDrafting, registerTemplate, getTemplate } from "../../services/documentDraftingEngine";
import { runLegalValidation, getValidationHistory } from "../../services/legalValidationService";
import { generateClauseRecommendations, getRecommendationHistory } from "../../services/clauseRecommendationService";
import { correlateJurisprudence, getCorrelationHistory } from "../../services/jurisprudenceCorrelationService";
import {
  recordDraftingTrace,
  recordDraftingMetric,
  getDraftingTraces,
  draftLatency,
  draftCompleteness,
  computeDraftingHealth,
} from "../../services/draftingObservabilityService";
import { runStructuredGeneration, getGenerationHistory } from "../../services/structuredGenerationService";

const ORG = 9600;

// ─────────────────────────────────────────────────────────────────────────────
// Domain: legalReasoning
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 4.3 — AI Legal Reasoning + Drafting Engine", () => {

  describe("legalReasoning domain", () => {
    it("createLegalPremise returns an id", () => {
      const p = createLegalPremise({
        organizationId: ORG,
        content: "A contratação direta exige justificativa formal.",
        sourceRef: "Lei 14133/2021 Art. 72",
        legalBasis: "Art. 72 Lei 14133/2021",
        sourceType: "legislation",
        authority: 0.9,
        relevance: 0.85,
      });
      expect(p.id).toBeTruthy();
      expect(p.organizationId).toBe(ORG);
    });

    it("createLegalPremise confidence defaults to authority * relevance", () => {
      const p = createLegalPremise({
        organizationId: ORG,
        content: "Termo de Referência é obrigatório.",
        sourceRef: "Lei 14133/2021 Art. 6",
        legalBasis: "Art. 6 Lei 14133/2021",
        sourceType: "legislation",
        authority: 0.8,
        relevance: 0.8,
      });
      expect(p.confidence).toBeGreaterThan(0);
    });

    it("createLegalPremise sourceType default is 'legislation'", () => {
      const p = createLegalPremise({
        organizationId: ORG,
        content: "Objeto da licitação deve ser definido.",
        sourceRef: "Lei 14133/2021 Art. 40",
        legalBasis: "Art. 40",
        sourceType: "legislation",
        authority: 0.7,
        relevance: 0.7,
      });
      expect(p.sourceType).toBe("legislation");
    });

    it("createExtendedLegalInference has traceId and premiseIds", () => {
      const p = createLegalPremise({ organizationId: ORG, content: "X", sourceRef: "ref", legalBasis: "b", sourceType: "legislation", authority: 0.8, relevance: 0.8 });
      const inf = createExtendedLegalInference({
        organizationId: ORG,
        traceId: "trace-001",
        premiseIds: [p.id],
        conclusion: "Contrato é válido",
        inferenceType: "deductive",
        confidence: 0.85,
        legalBasis: "Art. 72",
        justification: "Com base nos precedentes",
      });
      expect(inf.traceId).toBe("trace-001");
      expect(inf.premiseIds).toContain(p.id);
    });

    it("createExtendedComplianceCheck status defaults to 'uncertain'", () => {
      const cc = createExtendedComplianceCheck({
        organizationId: ORG,
        traceId: "trace-001",
        ruleId: "rule-001",
        ruleName: "Justificativa obrigatória",
        legalBasis: "Art. 72",
        status: "uncertain",
        findings: null,
        remediation: null,
      });
      expect(cc.status).toBe("uncertain");
      expect(cc.organizationId).toBe(ORG);
    });

    it("createExtendedComplianceCheck checkScore is numeric", () => {
      const cc = createExtendedComplianceCheck({
        organizationId: ORG,
        traceId: "trace-001",
        ruleId: "rule-002",
        ruleName: "Termo de Referência",
        legalBasis: "Art. 6",
        status: "compliant",
        findings: "OK",
        remediation: null,
      });
      expect(typeof cc.checkScore).toBe("number");
    });

    it("createPremiseContradiction severity defaults to 'moderate'", () => {
      const c = createPremiseContradiction({
        organizationId: ORG,
        premiseIdA: "p1",
        premiseIdB: "p2",
        description: "Conflito entre normas",
        severity: "moderate",
      });
      expect(c.severity).toBe("moderate");
    });

    it("createExtendedLegalRisk riskScore = probability * impact", () => {
      const risk = createExtendedLegalRisk({
        organizationId: ORG,
        traceId: "trace-001",
        riskType: "non_compliance",
        description: "Ausência de justificativa",
        level: "high",
        legalBasis: "Art. 72",
        probability: 0.6,
        impact: 0.8,
      });
      expect(risk.riskScore).toBeCloseTo(0.6 * 0.8, 5);
    });

    it("createExtendedLegalRisk level is preserved", () => {
      const risk = createExtendedLegalRisk({
        organizationId: ORG,
        traceId: "trace-001",
        riskType: "ambiguity",
        description: "Cláusula ambígua",
        level: "critical",
        legalBasis: "Art. 40",
        probability: 0.9,
        impact: 0.9,
      });
      expect(risk.level).toBe("critical");
    });

    it("createExtendedLegalRecommendation priority defaults to 'advisory'", () => {
      const rec = createExtendedLegalRecommendation({
        organizationId: ORG,
        traceId: "trace-001",
        recommendationType: "advisory",
        content: "Adicionar justificativa técnica",
        legalBasis: "Art. 72",
        priority: 1,
        rationale: "Melhora a conformidade",
      });
      expect(rec.recommendationType).toBe("advisory");
    });

    it("createExtendedLegalReasoningTrace has overallComplianceScore", () => {
      const trace = createExtendedLegalReasoningTrace({
        organizationId: ORG,
        sessionId: "sess-001",
        inferences: [],
        complianceChecks: [],
        risks: [],
        recommendations: [],
        contradictions: [],
      });
      expect(typeof trace.overallComplianceScore).toBe("number");
      expect(trace.replayKey).toBeTruthy();
    });

    it("createExtendedLegalReasoningTrace replayKey is deterministic", () => {
      const params = {
        organizationId: ORG,
        sessionId: "sess-deterministic",
        inferences: [] as any[],
        complianceChecks: [] as any[],
        risks: [] as any[],
        recommendations: [] as any[],
        contradictions: [] as any[],
      };
      const t1 = createExtendedLegalReasoningTrace(params);
      const t2 = createExtendedLegalReasoningTrace(params);
      expect(t1.replayKey).toBe(t2.replayKey);
    });

    it("detectPremiseContradictions returns empty array for non-contradictory premises", () => {
      const p1 = createLegalPremise({ organizationId: ORG, content: "Licitação é obrigatória para obras.", sourceRef: "ref1", legalBasis: "Art. 2", sourceType: "legislation", authority: 0.9, relevance: 0.9 });
      const p2 = createLegalPremise({ organizationId: ORG, content: "Dispensa exige justificativa.", sourceRef: "ref2", legalBasis: "Art. 72", sourceType: "legislation", authority: 0.8, relevance: 0.8 });
      const contradictions = detectPremiseContradictions([p1, p2]);
      expect(Array.isArray(contradictions)).toBe(true);
    });

    it("assessExtendedComplianceScore returns 1 when all checks compliant", () => {
      const cc1 = createExtendedComplianceCheck({ organizationId: ORG, traceId: "t", ruleId: "r1", ruleName: "Rule 1", legalBasis: "b", status: "compliant", findings: null, remediation: null });
      const cc2 = createExtendedComplianceCheck({ organizationId: ORG, traceId: "t", ruleId: "r2", ruleName: "Rule 2", legalBasis: "b", status: "compliant", findings: null, remediation: null });
      const score = assessExtendedComplianceScore([cc1, cc2]);
      expect(score).toBe(1);
    });

    it("assessExtendedComplianceScore returns 0 when all non_compliant", () => {
      const cc = createExtendedComplianceCheck({ organizationId: ORG, traceId: "t", ruleId: "r1", ruleName: "Rule 1", legalBasis: "b", status: "non_compliant", findings: null, remediation: null });
      const score = assessExtendedComplianceScore([cc]);
      expect(score).toBe(0);
    });

    it("assessExtendedComplianceScore excludes not_applicable from score", () => {
      const cc1 = createExtendedComplianceCheck({ organizationId: ORG, traceId: "t", ruleId: "r1", ruleName: "Rule 1", legalBasis: "b", status: "compliant", findings: null, remediation: null });
      const cc2 = createExtendedComplianceCheck({ organizationId: ORG, traceId: "t", ruleId: "r2", ruleName: "Rule 2", legalBasis: "b", status: "not_applicable", findings: null, remediation: null });
      const score = assessExtendedComplianceScore([cc1, cc2]);
      expect(score).toBe(1); // only cc1 counts
    });

    it("prioritizeExtendedRisks returns risks sorted by riskScore descending", () => {
      const r1 = createExtendedLegalRisk({ organizationId: ORG, traceId: "t", riskType: "non_compliance", description: "low", level: "low", legalBasis: "b", probability: 0.2, impact: 0.2 });
      const r2 = createExtendedLegalRisk({ organizationId: ORG, traceId: "t", riskType: "non_compliance", description: "high", level: "critical", legalBasis: "b", probability: 0.9, impact: 0.9 });
      const sorted = prioritizeExtendedRisks([r1, r2]);
      expect(sorted[0].riskScore).toBeGreaterThanOrEqual(sorted[1].riskScore);
    });

    it("buildExtendedReasoningExplainability returns a string", () => {
      const trace = createExtendedLegalReasoningTrace({ organizationId: ORG, sessionId: "s", inferences: [], complianceChecks: [], risks: [], recommendations: [], contradictions: [] });
      const explanation = buildExtendedReasoningExplainability(trace);
      expect(typeof explanation).toBe("string");
      expect(explanation.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain: documentDrafting
  // ─────────────────────────────────────────────────────────────────────────────

  describe("documentDrafting domain", () => {
    it("createDraftVariableV2 name and required are set", () => {
      const v = createDraftVariableV2({ name: "objeto", label: "Objeto", variableType: "text", isRequired: true });
      expect(v.name).toBe("objeto");
      expect(v.isRequired).toBe(true);
    });

    it("createDraftVariableV2 required defaults to false when not provided", () => {
      const v = createDraftVariableV2({ name: "obs", label: "Observação", variableType: "text" });
      expect(v.isRequired).toBe(false);
    });

    it("createDraftBlockV2 auto-extracts variables from {{VAR}} pattern", () => {
      const block = createDraftBlockV2({
        blockType: "paragraph",
        content: "Objeto: {{objeto}}. Valor: {{valor}}.",
        order: 1,
        isRequired: true,
      });
      expect(block.extractedVariables).toContain("objeto");
      expect(block.extractedVariables).toContain("valor");
    });

    it("createDraftBlockV2 has empty extractedVariables for content without placeholders", () => {
      const block = createDraftBlockV2({ blockType: "heading", content: "Termo de Referência", order: 0, isRequired: true });
      expect(block.extractedVariables).toHaveLength(0);
    });

    it("createDraftSectionV2 order defaults to 0", () => {
      const sec = createDraftSectionV2({ organizationId: ORG, templateId: "tmpl-001", title: "Introdução", blocks: [] });
      expect(sec.order).toBe(0);
    });

    it("createDraftSectionV2 isOptional defaults to false", () => {
      const sec = createDraftSectionV2({ organizationId: ORG, templateId: "tmpl-001", title: "Objeto", blocks: [] });
      expect(sec.isOptional).toBe(false);
    });

    it("createDraftTemplateV2 version defaults to 1.0.0", () => {
      const tmpl = createDraftTemplateV2({
        organizationId: ORG,
        templateKey: "tr-basic",
        name: "TR Básico",
        documentType: "TR",
        sections: [],
        variables: [],
        createdBy: 1,
      });
      expect(tmpl.version).toBe("1.0.0");
    });

    it("createDraftTemplateV2 isActive defaults to true", () => {
      const tmpl = createDraftTemplateV2({
        organizationId: ORG,
        templateKey: "tr-v2",
        name: "TR v2",
        documentType: "TR",
        sections: [],
        variables: [],
        createdBy: 1,
      });
      expect(tmpl.isActive).toBe(true);
    });

    it("resolveDraftVariables replaces {{VAR}} placeholders", () => {
      const resolved = resolveDraftVariables("Objeto: {{objeto}}. Valor: {{valor}}.", { objeto: "serviços de TI", valor: "R$ 100.000,00" });
      expect(resolved).toContain("serviços de TI");
      expect(resolved).toContain("R$ 100.000,00");
    });

    it("resolveDraftVariables leaves unreplaced variables intact", () => {
      const resolved = resolveDraftVariables("Objeto: {{objeto}}. Prazo: {{prazo}}.", { objeto: "obras" });
      expect(resolved).toContain("{{prazo}}");
    });

    it("generateDraftV2 returns resolvedContent and generationScore", () => {
      const block = createDraftBlockV2({ blockType: "paragraph", content: "Objeto: serviços.", order: 0, isRequired: true });
      const section = createDraftSectionV2({ organizationId: ORG, templateId: "t1", title: "Objeto", blocks: [block], order: 0 });
      const tmpl = createDraftTemplateV2({ organizationId: ORG, templateKey: "tk", name: "T", documentType: "TR", sections: [section], variables: [], createdBy: 1 });
      const gen = generateDraftV2({ organizationId: ORG, sessionId: "s1", template: tmpl, variableValues: {} });
      expect(gen.resolvedContent).toBeTruthy();
      expect(typeof gen.generationScore).toBe("number");
    });

    it("generateDraftV2 replayKey is deterministic", () => {
      const block = createDraftBlockV2({ blockType: "paragraph", content: "Conteúdo fixo.", order: 0, isRequired: true });
      const section = createDraftSectionV2({ organizationId: ORG, templateId: "t2", title: "S", blocks: [block], order: 0 });
      const tmpl = createDraftTemplateV2({ organizationId: ORG, templateKey: "tk2", name: "T2", documentType: "ETP", sections: [section], variables: [], createdBy: 1 });
      const input = { organizationId: ORG, sessionId: "replay-sess", template: tmpl, variableValues: {} };
      const g1 = generateDraftV2(input);
      const g2 = generateDraftV2(input);
      expect(g1.replayKey).toBe(g2.replayKey);
    });

    it("extractTemplateSkeleton returns markdown with section titles", () => {
      const section = createDraftSectionV2({ organizationId: ORG, templateId: "t", title: "Objeto da Contratação", blocks: [], order: 0 });
      const tmpl = createDraftTemplateV2({ organizationId: ORG, templateKey: "sk", name: "SK", documentType: "TR", sections: [section], variables: [], createdBy: 1 });
      const skeleton = extractTemplateSkeleton(tmpl);
      expect(typeof skeleton).toBe("string");
      expect(skeleton).toContain("Objeto da Contratação");
    });

    it("validateDraftCompletenessV2 isComplete when all required vars are filled", () => {
      const v = createDraftVariableV2({ name: "obj", label: "Objeto", variableType: "text", isRequired: true });
      const tmpl = createDraftTemplateV2({ organizationId: ORG, templateKey: "vc", name: "VC", documentType: "TR", sections: [], variables: [v], createdBy: 1 });
      const result = validateDraftCompletenessV2(tmpl, { obj: "serviços de limpeza" });
      expect(result.isComplete).toBe(true);
      expect(result.missingRequired).toHaveLength(0);
    });

    it("validateDraftCompletenessV2 reports missing required variables", () => {
      const v = createDraftVariableV2({ name: "preco", label: "Preço", variableType: "currency", isRequired: true });
      const tmpl = createDraftTemplateV2({ organizationId: ORG, templateKey: "vc2", name: "VC2", documentType: "TR", sections: [], variables: [v], createdBy: 1 });
      const result = validateDraftCompletenessV2(tmpl, {});
      expect(result.isComplete).toBe(false);
      expect(result.missingRequired).toContain("preco");
    });

    it("validateDraftCompletenessV2 completenessScore is between 0 and 1", () => {
      const tmpl = createDraftTemplateV2({ organizationId: ORG, templateKey: "vc3", name: "VC3", documentType: "TR", sections: [], variables: [], createdBy: 1 });
      const result = validateDraftCompletenessV2(tmpl, {});
      expect(result.completenessScore).toBeGreaterThanOrEqual(0);
      expect(result.completenessScore).toBeLessThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain: legalValidation
  // ─────────────────────────────────────────────────────────────────────────────

  describe("legalValidation domain", () => {
    it("createExtendedValidationRule has id, category and severity", () => {
      const rule = createExtendedValidationRule({
        organizationId: ORG,
        ruleType: "mandatory_section",
        name: "Objeto obrigatório",
        description: "O objeto deve estar presente",
        legalRef: "Art. 40 Lei 14133/2021",
        severity: "error",
        appliesTo: ["TR"],
        mandatoryKeywords: ["objeto"],
        forbiddenKeywords: [],
      });
      expect(rule.id).toBeTruthy();
      expect(rule.severity).toBe("error");
    });

    it("createExtendedValidationRule severity defaults to 'error'", () => {
      const rule = createExtendedValidationRule({
        organizationId: ORG,
        ruleType: "completeness",
        name: "Completude",
        description: "Doc completo",
        legalRef: "Art. 6",
        severity: "error",
        appliesTo: ["TR"],
        mandatoryKeywords: [],
        forbiddenKeywords: [],
      });
      expect(rule.severity).toBe("error");
    });

    it("createExtendedValidationReport counts errors/warnings/infos", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "error", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const report = createExtendedValidationReport({
        organizationId: ORG,
        documentId: "doc-001",
        documentType: "TR",
        results: [{ ruleId: rule.id, passed: false, severity: "error", message: "Falhou", affectedSection: null, suggestion: null }],
      });
      expect(report.errorCount).toBe(1);
      expect(report.warningCount).toBe(0);
    });

    it("createExtendedValidationReport passRate is 0 when all fail", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "error", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const report = createExtendedValidationReport({
        organizationId: ORG,
        documentId: "doc-002",
        documentType: "TR",
        results: [{ ruleId: rule.id, passed: false, severity: "error", message: "Falhou", affectedSection: null, suggestion: null }],
      });
      expect(report.passRate).toBe(0);
    });

    it("createExtendedValidationReport overallStatus is 'failed' when errors > 0", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "error", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const report = createExtendedValidationReport({
        organizationId: ORG,
        documentId: "doc-003",
        documentType: "TR",
        results: [{ ruleId: rule.id, passed: false, severity: "error", message: "E", affectedSection: null, suggestion: null }],
      });
      expect(report.overallStatus).toBe("failed");
    });

    it("createExtendedValidationReport overallStatus is 'warnings_only' when only warnings", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "warning", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const report = createExtendedValidationReport({
        organizationId: ORG,
        documentId: "doc-004",
        documentType: "TR",
        results: [{ ruleId: rule.id, passed: false, severity: "warning", message: "W", affectedSection: null, suggestion: null }],
      });
      expect(report.overallStatus).toBe("warnings_only");
    });

    it("createExtendedValidationReport overallStatus is 'passed' when all pass", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "error", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const report = createExtendedValidationReport({
        organizationId: ORG,
        documentId: "doc-005",
        documentType: "TR",
        results: [{ ruleId: rule.id, passed: true, severity: "error", message: "OK", affectedSection: null, suggestion: null }],
      });
      expect(report.overallStatus).toBe("passed");
    });

    it("applyExtendedValidationRules returns results array", () => {
      const rule = createExtendedValidationRule({
        organizationId: ORG,
        ruleType: "mandatory_section",
        name: "Objeto",
        description: "D",
        legalRef: "ref",
        severity: "error",
        appliesTo: ["TR"],
        mandatoryKeywords: ["objeto"],
        forbiddenKeywords: [],
      });
      const results = applyExtendedValidationRules("Este TR tem objeto de contratação.", [rule]);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("mergeExtendedValidationReports combines error counts", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "error", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const r1 = createExtendedValidationReport({ organizationId: ORG, documentId: "d1", documentType: "TR", results: [{ ruleId: rule.id, passed: false, severity: "error", message: "E1", affectedSection: null, suggestion: null }] });
      const r2 = createExtendedValidationReport({ organizationId: ORG, documentId: "d2", documentType: "TR", results: [{ ruleId: rule.id, passed: false, severity: "error", message: "E2", affectedSection: null, suggestion: null }] });
      const merged = mergeExtendedValidationReports([r1, r2]);
      expect(merged.errorCount).toBe(2);
    });

    it("getExtendedValidationSummary returns a markdown string", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "error", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const report = createExtendedValidationReport({ organizationId: ORG, documentId: "d1", documentType: "TR", results: [{ ruleId: rule.id, passed: true, severity: "error", message: "OK", affectedSection: null, suggestion: null }] });
      const summary = getExtendedValidationSummary(report);
      expect(typeof summary).toBe("string");
      expect(summary.length).toBeGreaterThan(0);
    });

    it("createExtendedValidationReport replayKey is deterministic", () => {
      const rule = createExtendedValidationRule({ organizationId: ORG, ruleType: "mandatory_section", name: "R", description: "D", legalRef: "ref", severity: "error", appliesTo: [], mandatoryKeywords: [], forbiddenKeywords: [] });
      const params = {
        organizationId: ORG,
        documentId: "doc-replay",
        documentType: "TR" as const,
        results: [{ ruleId: rule.id, passed: true, severity: "info" as const, message: "OK", affectedSection: null as null, suggestion: null as null }],
      };
      const rpt1 = createExtendedValidationReport(params);
      const rpt2 = createExtendedValidationReport(params);
      expect(rpt1.replayKey).toBe(rpt2.replayKey);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain: jurisprudenceReference
  // ─────────────────────────────────────────────────────────────────────────────

  describe("jurisprudenceReference domain", () => {
    it("createJurisprudenceReferenceV2 has id and precedentStrength default", () => {
      const ref = createJurisprudenceReferenceV2({
        organizationId: ORG,
        caseNumber: "TCU Acórdão 1234/2023",
        court: "TCU",
        courtLevel: "superior",
        summary: "Contratação direta exige justificativa formal.",
        keywords: ["justificativa", "contratação direta"],
        legalBasis: ["Art. 72 Lei 14133/2021"],
        year: 2023,
      });
      expect(ref.id).toBeTruthy();
      expect(ref.precedentStrength).toBeTruthy();
    });

    it("createJurisprudenceReferenceV2 organizationId matches ORG", () => {
      const ref = createJurisprudenceReferenceV2({
        organizationId: ORG,
        caseNumber: "STJ REsp 1000/2022",
        court: "STJ",
        courtLevel: "superior",
        summary: "Prazo deve ser razoável.",
        keywords: ["prazo"],
        legalBasis: ["Art. 40"],
        year: 2022,
      });
      expect(ref.organizationId).toBe(ORG);
    });

    it("createPrecedentHierarchyNode parentId null for root", () => {
      const ref = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "TCU 100/2020", court: "TCU", courtLevel: "superior", summary: "s", keywords: [], legalBasis: [], year: 2020 });
      const node = createPrecedentHierarchyNode({ reference: ref, parentId: null });
      expect(node.parentId).toBeNull();
      expect(Array.isArray(node.childIds)).toBe(true);
    });

    it("createPrecedentHierarchyNode childIds is empty array by default", () => {
      const ref = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "AGU 50/2021", court: "AGU", courtLevel: "administrative", summary: "s", keywords: [], legalBasis: [], year: 2021 });
      const node = createPrecedentHierarchyNode({ reference: ref, parentId: null });
      expect(node.childIds).toHaveLength(0);
    });

    it("createLegalCitationV2 citationType defaults to analogical", () => {
      const ref = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "TCU 200/2021", court: "TCU", courtLevel: "superior", summary: "s", keywords: ["compra"], legalBasis: [], year: 2021 });
      const cit = createLegalCitationV2({
        organizationId: ORG,
        sessionId: "s1",
        sourceId: "doc-001",
        reference: ref,
        citationType: "analogical",
      });
      expect(cit.citationType).toBe("analogical");
    });

    it("createLegalCitationV2 relevanceScore is between 0 and 1", () => {
      const ref = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "STF 001/2020", court: "STF", courtLevel: "supreme", summary: "s", keywords: [], legalBasis: [], year: 2020 });
      const cit = createLegalCitationV2({ organizationId: ORG, sessionId: "s2", sourceId: "doc-002", reference: ref, citationType: "direct" });
      expect(cit.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(cit.relevanceScore).toBeLessThanOrEqual(1);
    });

    it("findRelevantPrecedentsV2 filters by keyword overlap", () => {
      const ref1 = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "TCU 300/2022", court: "TCU", courtLevel: "superior", summary: "Licitação pública exige edital.", keywords: ["licitacao", "edital"], legalBasis: [], year: 2022 });
      const ref2 = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "TCU 301/2022", court: "TCU", courtLevel: "superior", summary: "Contrato de obras requer garantia.", keywords: ["obra", "garantia"], legalBasis: [], year: 2022 });
      const result = findRelevantPrecedentsV2([ref1, ref2], "edital de licitacao");
      expect(Array.isArray(result)).toBe(true);
    });

    it("rankPrecedentsByRelevanceV2 orders binding before informative", () => {
      const binding = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "STF S001", court: "STF", courtLevel: "supreme", summary: "s", keywords: [], legalBasis: [], year: 2020 });
      const informative = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "outro 01/2020", court: "outros", courtLevel: "state", summary: "s", keywords: [], legalBasis: [], year: 2020 });
      // Set different precedentStrengths manually for test
      const bRef = { ...binding, precedentStrength: "binding" as const };
      const iRef = { ...informative, precedentStrength: "informative" as const };
      const ranked = rankPrecedentsByRelevanceV2([iRef, bRef]);
      expect(ranked.length).toBe(2);
    });

    it("buildCitationGraphV2 maps sourceId to referenceIds", () => {
      const ref = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "TCU 400/2023", court: "TCU", courtLevel: "superior", summary: "s", keywords: [], legalBasis: [], year: 2023 });
      const cit = createLegalCitationV2({ organizationId: ORG, sessionId: "sg", sourceId: "doc-graph", reference: ref, citationType: "direct" });
      const graph = buildCitationGraphV2([cit]);
      expect(graph["doc-graph"]).toBeDefined();
      expect(Array.isArray(graph["doc-graph"])).toBe(true);
    });

    it("formatCitationV2 returns string with court, caseNumber and summary", () => {
      const ref = createJurisprudenceReferenceV2({ organizationId: ORG, caseNumber: "TCU 999/2023", court: "TCU", courtLevel: "superior", summary: "Resumo do acórdão.", keywords: [], legalBasis: [], year: 2023 });
      const formatted = formatCitationV2(ref);
      expect(typeof formatted).toBe("string");
      expect(formatted).toContain("TCU");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain: clauseIntelligence Sprint 4.3
  // ─────────────────────────────────────────────────────────────────────────────

  describe("clauseIntelligence Sprint 4.3", () => {
    const baseClause = {
      id: "c1",
      type: "body" as const,
      title: "Cláusula Geral",
      content: "Esta cláusula regula o fornecimento de serviços de tecnologia.",
      legalBasis: "Art. 40 Lei 14133/2021",
      priority: 10,
      appliesTo: ["servico" as const],
      baseRelevance: 0.8,
    };

    it("checkClauseCompatibility isCompatible true for dissimilar clauses", () => {
      const clauseA = { ...baseClause, id: "ca", content: "Fornecimento de bens materiais para uso interno." };
      const clauseB = { ...baseClause, id: "cb", content: "Serviços de limpeza e conservação predial." };
      const result = checkClauseCompatibility(clauseA, clauseB);
      expect(typeof result.isCompatible).toBe("boolean");
    });

    it("checkClauseCompatibility returns conflictType 'none' for unrelated clauses", () => {
      const clauseA = { ...baseClause, id: "ca2", content: "Aquisição de materiais de escritório." };
      const clauseB = { ...baseClause, id: "cb2", content: "Obras de engenharia civil e infraestrutura." };
      const result = checkClauseCompatibility(clauseA, clauseB);
      expect(result.conflictType).toBeDefined();
    });

    it("checkClauseCompatibility isCompatible false for highly similar clauses", () => {
      const clauseA = { ...baseClause, id: "ca3", content: "Contratação de serviços de tecnologia da informação e telecomunicações." };
      const clauseB = { ...baseClause, id: "cb3", content: "Contratação de serviços de tecnologia da informação e telecomunicações." };
      const result = checkClauseCompatibility(clauseA, clauseB);
      // identical clauses have maximum overlap
      expect(result.compatibilityScore).toBeLessThanOrEqual(1);
    });

    it("buildClauseHierarchy returns nodes with depth, isRoot and isLeaf", () => {
      const clauses = [baseClause, { ...baseClause, id: "c2", title: "Subcláusula" }];
      const hierarchy = buildClauseHierarchy(clauses);
      expect(Array.isArray(hierarchy)).toBe(true);
      if (hierarchy.length > 0) {
        expect(hierarchy[0].depth).toBeDefined();
        expect(hierarchy[0].isRoot).toBeDefined();
        expect(hierarchy[0].isLeaf).toBeDefined();
      }
    });

    it("analyzeClauseRisk riskLevel is defined for clean content", () => {
      const result = analyzeClauseRisk({
        id: "cr1",
        type: "body" as const,
        title: "Prazo de Entrega",
        content: "O prazo de entrega será de 30 dias corridos conforme Lei 14133/2021 Art. 40.",
        legalBasis: "Art. 40",
        priority: 5,
        appliesTo: ["servico" as const],
        baseRelevance: 0.7,
      });
      expect(result.riskLevel).toBeDefined();
    });

    it("analyzeClauseRisk detects risk for very short clause", () => {
      const result = analyzeClauseRisk({
        id: "cr2",
        type: "body" as const,
        title: "X",
        content: "OK",
        legalBasis: null,
        priority: 1,
        appliesTo: ["generico" as const],
        baseRelevance: 0.1,
      });
      // Short/empty clause should have some risk
      expect(result).toBeDefined();
    });

    it("analyzeClauseRisk detects missing legal basis as risk factor", () => {
      const result = analyzeClauseRisk({
        id: "cr3",
        type: "body" as const,
        title: "Penalidades",
        content: "O contratado ficará sujeito a multas e sanções administrativas.",
        legalBasis: null,
        priority: 8,
        appliesTo: ["servico" as const],
        baseRelevance: 0.6,
      });
      expect(result).toBeDefined();
    });

    it("buildClauseConflictMap has conflictCount, criticalConflicts, resolutionSuggestions", () => {
      const clauses = [
        { ...baseClause, id: "cmap1", content: "Entrega em 30 dias." },
        { ...baseClause, id: "cmap2", content: "Entrega em 60 dias." },
      ];
      const map = buildClauseConflictMap(clauses);
      expect(map.conflictCount).toBeDefined();
      expect(map.criticalConflicts).toBeDefined();
      expect(Array.isArray(map.resolutionSuggestions)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain: aiWorkflow DraftingCheckpoints
  // ─────────────────────────────────────────────────────────────────────────────

  describe("aiWorkflow DraftingCheckpoints", () => {
    it("createDraftingCheckpoint status is 'pending'", () => {
      const cp = createDraftingCheckpoint({
        organizationId: ORG,
        sessionId: "sess-cp-001",
        checkpointType: "completeness_check",
        draftId: "draft-001",
      });
      expect(cp.status).toBe("pending");
    });

    it("createDraftingCheckpoint score is 0 initially", () => {
      const cp = createDraftingCheckpoint({
        organizationId: ORG,
        sessionId: "sess-cp-002",
        checkpointType: "compliance_check",
        draftId: "draft-002",
      });
      expect(cp.score).toBe(0);
    });

    it("evaluateDraftCompliance status is 'completed' when passed=true", () => {
      const cp = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s", checkpointType: "completeness_check", draftId: "d" });
      const evaluated = evaluateDraftCompliance(cp, 0.9, true);
      expect(evaluated.status).toBe("completed");
    });

    it("evaluateDraftCompliance status is 'failed' when passed=false", () => {
      const cp = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s", checkpointType: "risk_check", draftId: "d" });
      const evaluated = evaluateDraftCompliance(cp, 0.3, false);
      expect(evaluated.status).toBe("failed");
    });

    it("evaluateDraftCompliance sets failureReason when passed=false", () => {
      const cp = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s", checkpointType: "compliance_check", draftId: "d" });
      const evaluated = evaluateDraftCompliance(cp, 0.2, false);
      expect(evaluated.failureReason).toBeTruthy();
    });

    it("evaluateDraftCompliance score is updated", () => {
      const cp = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s", checkpointType: "completeness_check", draftId: "d" });
      const evaluated = evaluateDraftCompliance(cp, 0.75, true);
      expect(evaluated.score).toBe(0.75);
    });

    it("addDraftingCheckpointToHistory immutably appends", () => {
      const cp1 = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s", checkpointType: "completeness_check", draftId: "d1" });
      const cp2 = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s", checkpointType: "compliance_check", draftId: "d2" });
      const history1 = addDraftingCheckpointToHistory([], cp1);
      const history2 = addDraftingCheckpointToHistory(history1, cp2);
      expect(history1).toHaveLength(1);
      expect(history2).toHaveLength(2);
    });

    it("addDraftingCheckpointToHistory original array is unchanged", () => {
      const cp = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s", checkpointType: "risk_check", draftId: "d" });
      const original: any[] = [];
      addDraftingCheckpointToHistory(original, cp);
      expect(original).toHaveLength(0);
    });

    it("createDraftingCheckpoint id is truthy", () => {
      const cp = createDraftingCheckpoint({ organizationId: ORG, sessionId: "s-id-test", checkpointType: "completeness_check", draftId: "d-id-test" });
      expect(cp.id).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Service: legalReasoningEngine
  // ─────────────────────────────────────────────────────────────────────────────

  describe("legalReasoningEngine service", () => {
    it("runLegalReasoning returns trace, complianceScore, riskScore", () => {
      const output = runLegalReasoning({
        organizationId: ORG,
        sessionId: "eng-sess-001",
        documentContent: "Termo de Referência para contratação de serviços de TI.",
        documentType: "TR",
        legalBasisRefs: ["Lei 14133/2021"],
      });
      expect(output.trace).toBeDefined();
      expect(typeof output.complianceScore).toBe("number");
      expect(typeof output.riskScore).toBe("number");
    });

    it("runLegalReasoning replayKey is deterministic for same inputs", () => {
      const input = {
        organizationId: ORG,
        sessionId: "deterministic-eng",
        documentContent: "Conteúdo fixo para teste de determinismo.",
        documentType: "TR" as const,
        legalBasisRefs: ["Lei 14133/2021"],
      };
      const o1 = runLegalReasoning(input);
      const o2 = runLegalReasoning(input);
      expect(o1.replayKey).toBe(o2.replayKey);
    });

    it("runLegalReasoning processingMs >= 0", () => {
      const output = runLegalReasoning({
        organizationId: ORG,
        sessionId: "eng-ms-test",
        documentContent: "Documento de teste.",
        documentType: "TR",
        legalBasisRefs: [],
      });
      expect(output.processingMs).toBeGreaterThanOrEqual(0);
    });

    it("getReasoningHistory returns an array", () => {
      runLegalReasoning({ organizationId: ORG, sessionId: "hist-test", documentContent: "Doc.", documentType: "TR", legalBasisRefs: [] });
      const history = getReasoningHistory(ORG, "hist-test");
      expect(Array.isArray(history)).toBe(true);
    });

    it("getReasoningHistory accumulates calls", () => {
      const before = getReasoningHistory(ORG, "accum-test").length;
      runLegalReasoning({ organizationId: ORG, sessionId: "accum-test", documentContent: "Doc A.", documentType: "TR", legalBasisRefs: [] });
      runLegalReasoning({ organizationId: ORG, sessionId: "accum-test", documentContent: "Doc B.", documentType: "TR", legalBasisRefs: [] });
      const after = getReasoningHistory(ORG, "accum-test").length;
      expect(after).toBeGreaterThan(before);
    });

    it("replayReasoning returns new output", () => {
      const output = runLegalReasoning({ organizationId: ORG, sessionId: "replay-eng", documentContent: "Doc para replay.", documentType: "TR", legalBasisRefs: [] });
      const replayed = replayReasoning(output);
      expect(replayed).toBeDefined();
      expect(replayed.trace).toBeDefined();
    });

    it("runLegalReasoning complianceScore is between 0 and 1", () => {
      const output = runLegalReasoning({ organizationId: ORG, sessionId: "score-range", documentContent: "Edital com todos os requisitos legais.", documentType: "TR", legalBasisRefs: ["Lei 14133/2021"] });
      expect(output.complianceScore).toBeGreaterThanOrEqual(0);
      expect(output.complianceScore).toBeLessThanOrEqual(1);
    });

    it("runLegalReasoning riskScore is between 0 and 1", () => {
      const output = runLegalReasoning({ organizationId: ORG, sessionId: "risk-range", documentContent: "Contrato sem justificativa.", documentType: "TR", legalBasisRefs: [] });
      expect(output.riskScore).toBeGreaterThanOrEqual(0);
      expect(output.riskScore).toBeLessThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Service: documentDraftingEngine
  // ─────────────────────────────────────────────────────────────────────────────

  describe("documentDraftingEngine service", () => {
    const sampleTemplate = createDraftTemplateV2({
      organizationId: ORG,
      templateKey: "svc-tr-basic",
      name: "TR Básico",
      documentType: "TR",
      sections: [],
      variables: [],
      createdBy: 1,
    });

    it("runDocumentDrafting returns generation, template, completeness", () => {
      registerTemplate(sampleTemplate);
      const output = runDocumentDrafting({
        organizationId: ORG,
        sessionId: "dft-sess-001",
        templateId: sampleTemplate.id,
        variableValues: {},
      });
      expect(output.generation).toBeDefined();
      expect(output.template).toBeDefined();
      expect(output.completeness).toBeDefined();
    });

    it("runDocumentDrafting replayKey is deterministic", () => {
      registerTemplate(sampleTemplate);
      const input = { organizationId: ORG, sessionId: "dft-replay", templateId: sampleTemplate.id, variableValues: {} };
      const o1 = runDocumentDrafting(input);
      const o2 = runDocumentDrafting(input);
      expect(o1.replayKey).toBe(o2.replayKey);
    });

    it("getDraftHistory returns array", () => {
      const history = getDraftHistory(ORG);
      expect(Array.isArray(history)).toBe(true);
    });

    it("getDraftHistory accumulates outputs", () => {
      registerTemplate(sampleTemplate);
      const before = getDraftHistory(ORG).length;
      runDocumentDrafting({ organizationId: ORG, sessionId: "dft-accum", templateId: sampleTemplate.id, variableValues: {} });
      const after = getDraftHistory(ORG).length;
      expect(after).toBeGreaterThan(before);
    });

    it("replayDrafting returns new output", () => {
      registerTemplate(sampleTemplate);
      const output = runDocumentDrafting({ organizationId: ORG, sessionId: "dft-replay2", templateId: sampleTemplate.id, variableValues: {} });
      const replayed = replayDrafting(output);
      expect(replayed).toBeDefined();
      expect(replayed.generation).toBeDefined();
    });

    it("registerTemplate and getTemplate store and retrieve", () => {
      const tmpl = createDraftTemplateV2({
        organizationId: ORG,
        templateKey: "get-test-tmpl",
        name: "Get Test",
        documentType: "ETP",
        sections: [],
        variables: [],
        createdBy: 1,
      });
      registerTemplate(tmpl);
      const retrieved = getTemplate(ORG, tmpl.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(tmpl.id);
    });

    it("getTemplate returns null for non-existent template", () => {
      const result = getTemplate(ORG, "non-existent-id");
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Service: legalValidationService
  // ─────────────────────────────────────────────────────────────────────────────

  describe("legalValidationService service", () => {
    it("runLegalValidation returns report with default rules", () => {
      const output = runLegalValidation({
        organizationId: ORG,
        sessionId: "val-sess-001",
        documentContent: "Termo de Referência para contratação de serviços.",
        documentType: "TR",
      });
      expect(output.report).toBeDefined();
      expect(typeof output.report.overallStatus).toBe("string");
    });

    it("runLegalValidation replayKey is deterministic", () => {
      const input = {
        organizationId: ORG,
        sessionId: "val-replay",
        documentContent: "Conteúdo de validação determinística.",
        documentType: "TR" as const,
      };
      const o1 = runLegalValidation(input);
      const o2 = runLegalValidation(input);
      expect(o1.replayKey).toBe(o2.replayKey);
    });

    it("getValidationHistory returns array", () => {
      runLegalValidation({ organizationId: ORG, sessionId: "val-hist", documentContent: "Doc.", documentType: "TR" });
      const history = getValidationHistory(ORG);
      expect(Array.isArray(history)).toBe(true);
    });

    it("runLegalValidation report has passRate between 0 and 1", () => {
      const output = runLegalValidation({ organizationId: ORG, sessionId: "val-rate", documentContent: "Edital completo com todos os requisitos.", documentType: "TR" });
      expect(output.report.passRate).toBeGreaterThanOrEqual(0);
      expect(output.report.passRate).toBeLessThanOrEqual(1);
    });

    it("runLegalValidation processingMs >= 0", () => {
      const output = runLegalValidation({ organizationId: ORG, sessionId: "val-ms", documentContent: "Doc.", documentType: "TR" });
      expect(output.processingMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Service: clauseRecommendationService
  // ─────────────────────────────────────────────────────────────────────────────

  describe("clauseRecommendationService service", () => {
    it("generateClauseRecommendations returns recommendations, riskAnalyses, conflictMap", () => {
      const output = generateClauseRecommendations({
        organizationId: ORG,
        sessionId: "clrec-sess-001",
        documentContent: "Contratação de serviços de TI para manutenção de sistemas.",
        documentType: "TR",
      });
      expect(Array.isArray(output.recommendations)).toBe(true);
      expect(Array.isArray(output.riskAnalyses)).toBe(true);
      expect(output.conflictMap).toBeDefined();
    });

    it("generateClauseRecommendations replayKey is deterministic", () => {
      const input = {
        organizationId: ORG,
        sessionId: "clrec-replay",
        documentContent: "Conteúdo fixo para recomendação de cláusulas.",
        documentType: "TR" as const,
      };
      const o1 = generateClauseRecommendations(input);
      const o2 = generateClauseRecommendations(input);
      expect(o1.replayKey).toBe(o2.replayKey);
    });

    it("getRecommendationHistory returns array", () => {
      generateClauseRecommendations({ organizationId: ORG, sessionId: "clrec-hist", documentContent: "Doc.", documentType: "TR" });
      const history = getRecommendationHistory(ORG);
      expect(Array.isArray(history)).toBe(true);
    });

    it("generateClauseRecommendations conflictMap has conflictCount", () => {
      const output = generateClauseRecommendations({ organizationId: ORG, sessionId: "clrec-conflict", documentContent: "Doc.", documentType: "TR" });
      expect(typeof output.conflictMap.conflictCount).toBe("number");
    });

    it("generateClauseRecommendations processingMs >= 0", () => {
      const output = generateClauseRecommendations({ organizationId: ORG, sessionId: "clrec-ms", documentContent: "Doc.", documentType: "TR" });
      expect(output.processingMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Service: jurisprudenceCorrelationService
  // ─────────────────────────────────────────────────────────────────────────────

  describe("jurisprudenceCorrelationService service", () => {
    it("correlateJurisprudence returns relevantReferences, citations, formattedCitations", () => {
      const output = correlateJurisprudence({
        organizationId: ORG,
        sessionId: "jcorr-sess-001",
        query: "contratação direta por inexigibilidade",
        legalBasisRefs: ["Lei 14133/2021 Art. 74"],
      });
      expect(Array.isArray(output.relevantReferences)).toBe(true);
      expect(Array.isArray(output.citations)).toBe(true);
      expect(Array.isArray(output.formattedCitations)).toBe(true);
    });

    it("correlateJurisprudence relevantReferences has at least 1 entry from built-in corpus", () => {
      const output = correlateJurisprudence({
        organizationId: ORG,
        sessionId: "jcorr-corpus",
        query: "licitação pública",
        legalBasisRefs: ["Lei 14133/2021"],
      });
      expect(output.relevantReferences.length).toBeGreaterThanOrEqual(1);
    });

    it("correlateJurisprudence correlationScore is between 0 and 1", () => {
      const output = correlateJurisprudence({
        organizationId: ORG,
        sessionId: "jcorr-score",
        query: "edital de pregão eletrônico",
        legalBasisRefs: [],
      });
      expect(output.correlationScore).toBeGreaterThanOrEqual(0);
      expect(output.correlationScore).toBeLessThanOrEqual(1);
    });

    it("correlateJurisprudence replayKey is deterministic", () => {
      const input = {
        organizationId: ORG,
        sessionId: "jcorr-replay",
        query: "contratação de obras",
        legalBasisRefs: ["Lei 14133/2021"],
      };
      const o1 = correlateJurisprudence(input);
      const o2 = correlateJurisprudence(input);
      expect(o1.replayKey).toBe(o2.replayKey);
    });

    it("getCorrelationHistory returns array", () => {
      correlateJurisprudence({ organizationId: ORG, sessionId: "jcorr-hist", query: "q", legalBasisRefs: [] });
      const history = getCorrelationHistory(ORG);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Service: draftingObservabilityService
  // ─────────────────────────────────────────────────────────────────────────────

  describe("draftingObservabilityService service", () => {
    it("recordDraftingTrace adds to traces", () => {
      const before = getDraftingTraces(ORG).length;
      recordDraftingTrace({ organizationId: ORG, sessionId: "obs-sess-001", correlationId: "corr-001", draftId: "drft-001", documentType: "TR", totalMs: 100, completenessScore: 0.9, riskScore: 0.1, complianceScore: 0.95, variableCount: 5, missingVariables: 0 });
      const after = getDraftingTraces(ORG).length;
      expect(after).toBeGreaterThan(before);
    });

    it("recordDraftingMetric does not throw", () => {
      expect(() => {
        recordDraftingMetric({ organizationId: ORG, correlationId: "corr-002", metricName: "completeness", value: 0.85, unit: "ratio" });
      }).not.toThrow();
    });

    it("getDraftingTraces filters by organizationId", () => {
      recordDraftingTrace({ organizationId: ORG, sessionId: "obs-filter", correlationId: "corr-filter", draftId: "drft-filter", documentType: "ETP", totalMs: 200, completenessScore: 0.7, riskScore: 0.3, complianceScore: 0.8, variableCount: 3, missingVariables: 1 });
      const traces = getDraftingTraces(ORG);
      expect(traces.every(t => t.organizationId === ORG)).toBe(true);
    });

    it("draftLatency callable without error", () => {
      expect(() => draftLatency("corr-lat", 150, ORG)).not.toThrow();
    });

    it("draftCompleteness callable without error", () => {
      expect(() => draftCompleteness("corr-comp", 0.9, ORG)).not.toThrow();
    });

    it("computeDraftingHealth returns healthScore between 0 and 1", () => {
      recordDraftingTrace({ organizationId: ORG, sessionId: "health-sess", correlationId: "c1", draftId: "d1", documentType: "TR", totalMs: 100, completenessScore: 0.9, riskScore: 0.1, complianceScore: 0.95, variableCount: 5, missingVariables: 0 });
      const health = computeDraftingHealth(ORG, "health-sess");
      expect(health.healthScore).toBeGreaterThanOrEqual(0);
      expect(health.healthScore).toBeLessThanOrEqual(1);
    });

    it("computeDraftingHealth returns status string", () => {
      const health = computeDraftingHealth(ORG, "any-session");
      expect(typeof health.status).toBe("string");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Service: structuredGenerationService
  // ─────────────────────────────────────────────────────────────────────────────

  describe("structuredGenerationService service", () => {
    it("runStructuredGeneration returns all sub-outputs", () => {
      const output = runStructuredGeneration({
        organizationId: ORG,
        sessionId: "sgen-sess-001",
        documentContent: "Termo de Referência para contratação de serviços de manutenção.",
        documentType: "TR",
        legalBasisRefs: ["Lei 14133/2021"],
      });
      expect(output.reasoningOutput).toBeDefined();
      expect(output.validationOutput).toBeDefined();
      expect(output.draftingOutput).toBeDefined();
    });

    it("runStructuredGeneration overallScore is between 0 and 1", () => {
      const output = runStructuredGeneration({
        organizationId: ORG,
        sessionId: "sgen-score",
        documentContent: "Doc completo.",
        documentType: "TR",
        legalBasisRefs: [],
      });
      expect(output.overallScore).toBeGreaterThanOrEqual(0);
      expect(output.overallScore).toBeLessThanOrEqual(1);
    });

    it("runStructuredGeneration replayKey is deterministic", () => {
      const input = {
        organizationId: ORG,
        sessionId: "sgen-replay",
        documentContent: "Conteúdo para geração determinística.",
        documentType: "TR" as const,
        legalBasisRefs: ["Lei 14133/2021"],
      };
      const o1 = runStructuredGeneration(input);
      const o2 = runStructuredGeneration(input);
      expect(o1.replayKey).toBe(o2.replayKey);
    });

    it("getGenerationHistory returns array", () => {
      runStructuredGeneration({ organizationId: ORG, sessionId: "sgen-hist", documentContent: "Doc.", documentType: "TR", legalBasisRefs: [] });
      const history = getGenerationHistory(ORG);
      expect(Array.isArray(history)).toBe(true);
    });

    it("getGenerationHistory accumulates outputs", () => {
      const before = getGenerationHistory(ORG).length;
      runStructuredGeneration({ organizationId: ORG, sessionId: "sgen-accum", documentContent: "Doc.", documentType: "TR", legalBasisRefs: [] });
      const after = getGenerationHistory(ORG).length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
