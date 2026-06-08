import { createHash } from "crypto";
import {
  type LegalReasoningTrace,
  type LegalPremise,
  type LegalInference,
  type ComplianceCheck,
  type LegalRisk,
  type LegalRecommendation,
  createLegalPremise,
  createLegalInference,
  createComplianceCheck,
  createLegalRisk,
  createLegalRecommendation,
  createLegalReasoningTrace,
  detectLegalContradictions,
  assessComplianceScore,
  prioritizeRisks,
  buildReasoningExplainability,
} from "../domain/legalReasoning";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReasoningEngineInput {
  organizationId: number;
  sessionId: string;
  documentContent: string;
  legalBasisRefs: string[];
  contextFragments?: string[];
  complianceRules?: Array<{ ruleId: string; ruleName: string; legalBasis: string; expression: string }>;
}

export interface ReasoningEngineOutput {
  trace: LegalReasoningTrace;
  complianceScore: number;
  riskScore: number;
  topRisks: LegalRisk[];
  topRecommendations: LegalRecommendation[];
  explainability: string;
  processingMs: number;
  replayKey: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _reasoningHistory = new Map<number, Map<string, ReasoningEngineOutput[]>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

function extractPremises(content: string, legalBasisRefs: string[], organizationId: number, traceId: string): LegalPremise[] {
  // Extract premises from sentences containing legal keywords
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const legalKeywords = /lei|artigo|art\.|decreto|instrução|regulamento|norma|§|inciso/i;
  return sentences
    .filter(s => legalKeywords.test(s))
    .slice(0, 10)
    .map((sentence, i) => createLegalPremise({
      organizationId,
      content: sentence.trim(),
      legalBasis: legalBasisRefs[i % legalBasisRefs.length] ?? "Lei 14133/2021",
      confidence: 0.75 + (i % 3) * 0.05,
      sourceType: "statutory",
    }));
}

function generateInferences(premises: LegalPremise[], organizationId: number, traceId: string): LegalInference[] {
  if (premises.length < 2) return [];
  return premises.slice(0, Math.min(premises.length - 1, 5)).map((premise, i) => {
    const next = premises[i + 1];
    return createLegalInference({
      organizationId,
      traceId,
      premiseIds: [premise.id, next.id],
      conclusion: `Com base em "${premise.legalBasis}" e "${next.legalBasis}", conclui-se que as obrigações são cumulativas.`,
      inferenceType: "deductive",
      confidence: Math.min(premise.confidence, next.confidence) * 0.9,
      legalBasis: premise.legalBasis,
      justification: "Inferência por combinação de premissas de mesma fonte normativa",
    });
  });
}

function runComplianceChecks(
  rules: Array<{ ruleId: string; ruleName: string; legalBasis: string; expression: string }>,
  content: string,
  organizationId: number,
  traceId: string,
): ComplianceCheck[] {
  return rules.map(rule => {
    const keywords = rule.expression.split(/\s+/).filter(w => w.length > 3);
    const found = keywords.some(kw => content.toLowerCase().includes(kw.toLowerCase()));
    return createComplianceCheck({
      organizationId,
      traceId,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      legalBasis: rule.legalBasis,
      status: found ? "compliant" : "uncertain",
      findings: found
        ? `Requisito "${rule.ruleName}" encontrado no documento`
        : `Requisito "${rule.ruleName}" não identificado claramente`,
      evidence: found ? [rule.expression] : [],
      remediation: found ? null : `Adicionar referência explícita a: ${rule.legalBasis}`,
      checkScore: found ? 0.85 : 0.4,
    });
  });
}

function generateRisks(content: string, premises: LegalPremise[], organizationId: number, traceId: string): LegalRisk[] {
  const risks: LegalRisk[] = [];
  const riskPatterns = [
    { pattern: /sem licitação|dispensa|inexigibilidade/i, type: "Dispensa de licitação", level: "high" as const, prob: 0.6, impact: 0.8 },
    { pattern: /multa|penalidade|rescisão unilateral/i, type: "Responsabilidade contratual", level: "medium" as const, prob: 0.5, impact: 0.6 },
    { pattern: /sigiloso|confidencial|restrito/i, type: "Acesso à informação", level: "medium" as const, prob: 0.4, impact: 0.5 },
    { pattern: /prazo|vigência|prorrogação/i, type: "Risco de prazo", level: "low" as const, prob: 0.3, impact: 0.4 },
  ];
  for (const { pattern, type, level, prob, impact } of riskPatterns) {
    if (pattern.test(content)) {
      risks.push(createLegalRisk({
        organizationId,
        traceId,
        riskType: type,
        description: `Risco identificado: ${type}`,
        level,
        legalBasis: premises[0]?.legalBasis ?? "Lei 14133/2021",
        probability: prob,
        impact,
        mitigations: [`Revisar fundamentação legal para ${type}`, "Documentar justificativas conforme exigido"],
      }));
    }
  }
  return risks;
}

function generateRecommendations(
  checks: ComplianceCheck[],
  risks: LegalRisk[],
  organizationId: number,
  traceId: string,
): LegalRecommendation[] {
  const recs: LegalRecommendation[] = [];
  let priority = 1;
  for (const check of checks.filter(c => c.status !== "compliant")) {
    recs.push(createLegalRecommendation({
      organizationId,
      traceId,
      type: "mandatory",
      content: check.remediation ?? `Corrigir não conformidade: ${check.ruleName}`,
      legalBasis: check.legalBasis,
      priority: priority++,
      rationale: check.findings,
    }));
  }
  for (const risk of risks.filter(r => r.level === "critical" || r.level === "high")) {
    recs.push(createLegalRecommendation({
      organizationId,
      traceId,
      type: "advisory",
      content: risk.mitigations[0] ?? `Mitigar risco: ${risk.riskType}`,
      legalBasis: risk.legalBasis,
      priority: priority++,
      rationale: risk.description,
    }));
  }
  return recs;
}

// ─── Service functions ────────────────────────────────────────────────────────

export function runLegalReasoning(input: ReasoningEngineInput): ReasoningEngineOutput {
  const start = Date.now();
  const {
    organizationId, sessionId, documentContent, legalBasisRefs,
    contextFragments = [], complianceRules = [],
  } = input;

  const traceId = sha256(`${organizationId}${sessionId}${documentContent.slice(0, 50)}`).slice(0, 20);
  const fullContent = [documentContent, ...contextFragments].join("\n");

  const premises = extractPremises(fullContent, legalBasisRefs, organizationId, traceId);
  const inferences = generateInferences(premises, organizationId, traceId);
  const contradictions = detectLegalContradictions(premises);
  const checks = runComplianceChecks(complianceRules, fullContent, organizationId, traceId);
  const risks = generateRisks(fullContent, premises, organizationId, traceId);
  const recommendations = generateRecommendations(checks, risks, organizationId, traceId);

  const trace = createLegalReasoningTrace({
    organizationId, sessionId, premises, inferences,
    complianceChecks: checks, contradictions, risks, recommendations,
  });

  const topRisks = prioritizeRisks(risks).slice(0, 5);
  const topRecommendations = recommendations.slice(0, 5);
  const complianceScore = assessComplianceScore(checks);
  const riskScore = trace.overallRiskScore;
  const explainability = buildReasoningExplainability(trace);

  const replayKey = sha256(JSON.stringify({
    organizationId,
    sessionId,
    contentHash: sha256(documentContent),
    legalBasisRefs: [...legalBasisRefs].sort(),
    ruleIds: complianceRules.map(r => r.ruleId).sort(),
  }));

  const output: ReasoningEngineOutput = {
    trace,
    complianceScore,
    riskScore,
    topRisks,
    topRecommendations,
    explainability,
    processingMs: Date.now() - start,
    replayKey,
  };

  const orgMap = _reasoningHistory.get(organizationId) ?? new Map();
  const sessionHistory = orgMap.get(sessionId) ?? [];
  orgMap.set(sessionId, [...sessionHistory, output]);
  _reasoningHistory.set(organizationId, orgMap);

  return output;
}

export function getReasoningHistory(organizationId: number, sessionId: string): ReasoningEngineOutput[] {
  return _reasoningHistory.get(organizationId)?.get(sessionId) ?? [];
}

export function replayReasoning(output: ReasoningEngineOutput, newContent?: string): ReasoningEngineOutput {
  return runLegalReasoning({
    organizationId: output.trace.organizationId,
    sessionId: output.trace.sessionId,
    documentContent: newContent ?? output.trace.premises.map(p => p.content).join(". "),
    legalBasisRefs: [...new Set(output.trace.premises.map(p => p.legalBasis))],
    complianceRules: output.trace.complianceChecks.map(c => ({
      ruleId: c.ruleId,
      ruleName: c.ruleName,
      legalBasis: c.legalBasis,
      expression: c.ruleName,
    })),
  });
}
