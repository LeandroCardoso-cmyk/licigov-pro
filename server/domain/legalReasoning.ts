/**
 * Sprint 4.3 — Legal Reasoning Domain.
 *
 * Motor de raciocínio jurídico para análise de conformidade com a Lei 14.133/2021.
 * Provê evidence chains, inferências jurídicas, detecção de contradições,
 * avaliação de riscos e recomendações auditáveis.
 *
 * PRINCÍPIOS:
 *   - Determinismo: replayKey garante idempotência de geração.
 *   - Imutabilidade: funções retornam novos objetos (nunca mutam entradas).
 *   - Explainability: toda conclusão carrega justificativa e base legal.
 *   - Proveniência: toda inferência referencia evidências-fonte.
 *   - Multi-tenant: organizationId obrigatório em todos os artefatos.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LegalReasoningStageType =
  | "norm_parsing"       // análise de normas aplicáveis
  | "precedent_lookup"   // busca de precedentes
  | "fact_analysis"      // análise dos fatos do caso
  | "legal_inference"    // inferência jurídica
  | "compliance_check"   // verificação de conformidade
  | "risk_assessment"    // avaliação de riscos
  | "recommendation"     // recomendação jurídica
  | "conclusion";        // conclusão

export type LegalConfidenceLevel = "high" | "medium" | "low" | "uncertain";
export type ComplianceStatus = "compliant" | "non_compliant" | "partial" | "unknown" | "requires_review";
export type LegalRiskLevel = "critical" | "high" | "medium" | "low" | "none";
export type NormativeHierarchyLevel = "constitution" | "federal_law" | "decree" | "regulation" | "ordinance" | "internal";

export interface LegalEvidence {
  id: string;
  organizationId: number;
  sourceRef: string;          // ex: "Lei 14133/2021 Art. 6"
  content: string;
  hierarchyLevel: NormativeHierarchyLevel;
  authority: number;          // 0-1
  relevanceScore: number;     // 0-1
  isVerified: boolean;
  citationKey: string;
  legalBasis: string;
  replayKey: string;
  createdAt: string;
}

export interface LegalInference {
  id: string;
  organizationId: number;
  premiseIds: string[];       // IDs das evidências que fundamentam
  conclusion: string;
  confidenceLevel: LegalConfidenceLevel;
  confidenceScore: number;    // 0-1
  legalBasis: string;
  stageType: LegalReasoningStageType;
  evidenceRefs: string[];
  justification: string;
  isContradicted: boolean;
  replayKey: string;
  createdAt: string;
}

export interface ComplianceCheck {
  id: string;
  organizationId: number;
  documentId: string;
  ruleRef: string;            // ex: "Lei 14133/2021 Art. 40 §1º"
  status: ComplianceStatus;
  description: string;
  severity: "error" | "warning" | "info";
  mandatorySection: string | null;
  remediation: string | null;
  evidenceRef: string | null;
  replayKey: string;
  checkedAt: string;
}

export interface Contradiction {
  id: string;
  organizationId: number;
  inferenceIdA: string;
  inferenceIdB: string;
  description: string;
  severity: "critical" | "moderate" | "minor";
  resolution: "override_a" | "override_b" | "merge" | "escalate" | "unresolved";
  resolutionNote: string | null;
  detectedAt: string;
}

export interface LegalRisk {
  id: string;
  organizationId: number;
  riskType: "non_compliance" | "ambiguity" | "missing_justification" | "invalid_reference" | "contradiction" | "procedural";
  level: LegalRiskLevel;
  description: string;
  affectedSection: string;
  legalBasis: string | null;
  mitigationSuggestion: string;
  probability: number;        // 0-1
  impact: number;             // 0-1
  riskScore: number;          // probability * impact
  isResolved: boolean;
  replayKey: string;
  createdAt: string;
}

export interface LegalRecommendation {
  id: string;
  organizationId: number;
  recommendationType: "add_section" | "remove_clause" | "modify_clause" | "add_justification" | "cite_precedent" | "escalate";
  title: string;
  description: string;
  legalBasis: string;
  priority: "critical" | "high" | "medium" | "low";
  evidenceRefs: string[];
  confidence: number;         // 0-1
  replayKey: string;
  createdAt: string;
}

export interface LegalReasoningTrace {
  id: string;
  organizationId: number;
  sessionId: string;
  documentId: string;
  stages: LegalReasoningStageType[];
  inferences: LegalInference[];
  complianceChecks: ComplianceCheck[];
  contradictions: Contradiction[];
  risks: LegalRisk[];
  recommendations: LegalRecommendation[];
  overallCompliance: ComplianceStatus;
  overallConfidence: number;
  totalRisks: number;
  criticalRisks: number;
  replayKey: string;
  createdAt: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function deterministicId(input: string): string {
  return sha256Hex(input).slice(0, 20);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Tokeniza texto em lowercase sem acentos para comparação semântica. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/** Pares de palavras opostas para detecção de contradições jurídicas. */
const LEGAL_OPPOSITE_PAIRS: Array<[string, string]> = [
  ["permitido", "proibido"],
  ["obrigatorio", "facultativo"],
  ["valido", "invalido"],
  ["deve", "nao deve"],
  ["exigido", "dispensado"],
  ["obrigatorio", "opcional"],
  ["permitido", "vedado"],
  ["legal", "ilegal"],
];

function detectOppositeKeywords(textA: string, textB: string): Array<[string, string]> {
  const tokA = new Set(tokenize(textA));
  const tokB = new Set(tokenize(textB));
  const found: Array<[string, string]> = [];
  for (const [wordA, wordB] of LEGAL_OPPOSITE_PAIRS) {
    if (tokA.has(wordA) && tokB.has(wordB)) found.push([wordA, wordB]);
    if (tokA.has(wordB) && tokB.has(wordA)) found.push([wordB, wordA]);
  }
  return found;
}

// ─── Factory functions ────────────────────────────────────────────────────────

/**
 * Cria uma evidência jurídica com replayKey determinístico.
 * replayKey = sha256(citationKey + content + organizationId)
 */
export function createLegalEvidence(params: {
  organizationId: number;
  sourceRef: string;
  content: string;
  hierarchyLevel: NormativeHierarchyLevel;
  authority: number;
  relevanceScore: number;
  legalBasis: string;
  citationKey: string;
  isVerified?: boolean;
}): LegalEvidence {
  const replayKey = sha256Hex(
    `${params.citationKey}${params.content}${params.organizationId}`,
  );
  const id = deterministicId(replayKey);
  return {
    id,
    organizationId: params.organizationId,
    sourceRef:      params.sourceRef,
    content:        params.content,
    hierarchyLevel: params.hierarchyLevel,
    authority:      clamp01(params.authority),
    relevanceScore: clamp01(params.relevanceScore),
    isVerified:     params.isVerified ?? false,
    citationKey:    params.citationKey,
    legalBasis:     params.legalBasis,
    replayKey,
    createdAt:      new Date().toISOString(),
  };
}

/**
 * Cria uma inferência jurídica com nível de confiança calculado e replayKey determinístico.
 * confidenceLevel: >= 0.85 → "high", >= 0.65 → "medium", >= 0.45 → "low", else → "uncertain"
 * replayKey = sha256(organizationId + stageType + sorted(premiseIds).join + conclusion)
 */
export function createLegalInference(params: {
  organizationId: number;
  premiseIds: string[];
  conclusion: string;
  confidenceScore: number;
  legalBasis: string;
  stageType: LegalReasoningStageType;
  evidenceRefs: string[];
  justification: string;
}): LegalInference {
  const score = clamp01(params.confidenceScore);
  const confidenceLevel: LegalConfidenceLevel =
    score >= 0.85 ? "high"
    : score >= 0.65 ? "medium"
    : score >= 0.45 ? "low"
    : "uncertain";

  const sortedPremises = [...params.premiseIds].sort().join("|");
  const replayKey = sha256Hex(
    `${params.organizationId}${params.stageType}${sortedPremises}${params.conclusion}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    organizationId:  params.organizationId,
    premiseIds:      params.premiseIds,
    conclusion:      params.conclusion,
    confidenceLevel,
    confidenceScore: score,
    legalBasis:      params.legalBasis,
    stageType:       params.stageType,
    evidenceRefs:    params.evidenceRefs,
    justification:   params.justification,
    isContradicted:  false,
    replayKey,
    createdAt:       new Date().toISOString(),
  };
}

/**
 * Cria um check de conformidade com replayKey determinístico.
 * replayKey = sha256(documentId + ruleRef + status + organizationId)
 */
export function createComplianceCheck(params: {
  organizationId: number;
  documentId: string;
  ruleRef: string;
  status: ComplianceStatus;
  description: string;
  severity: "error" | "warning" | "info";
  mandatorySection?: string | null;
  remediation?: string | null;
  evidenceRef?: string | null;
}): ComplianceCheck {
  const replayKey = sha256Hex(
    `${params.documentId}${params.ruleRef}${params.status}${params.organizationId}`,
  );
  const id = deterministicId(replayKey);
  return {
    id,
    organizationId:   params.organizationId,
    documentId:       params.documentId,
    ruleRef:          params.ruleRef,
    status:           params.status,
    description:      params.description,
    severity:         params.severity,
    mandatorySection: params.mandatorySection ?? null,
    remediation:      params.remediation ?? null,
    evidenceRef:      params.evidenceRef ?? null,
    replayKey,
    checkedAt:        new Date().toISOString(),
  };
}

/**
 * Detecta contradições entre pares de inferências buscando palavras opostas.
 * Retorna lista de contradições com severity baseada na quantidade de pares opostos.
 */
export function detectLegalContradictions(inferences: LegalInference[]): Contradiction[] {
  const now = new Date().toISOString();
  const contradictions: Contradiction[] = [];

  for (let i = 0; i < inferences.length; i++) {
    for (let j = i + 1; j < inferences.length; j++) {
      const a = inferences[i];
      const b = inferences[j];
      const opposites = detectOppositeKeywords(a.conclusion, b.conclusion);
      if (opposites.length === 0) continue;

      const severity: Contradiction["severity"] =
        opposites.length >= 3 ? "critical"
        : opposites.length === 2 ? "moderate"
        : "minor";

      const desc = `Contradição entre inferência "${a.id}" e "${b.id}": pares opostos detectados [${opposites.map(([x, y]) => `"${x}"/"${y}"`).join(", ")}].`;
      const contraId = deterministicId(`${a.id}${b.id}${severity}`);

      contradictions.push({
        id:             contraId,
        organizationId: a.organizationId,
        inferenceIdA:   a.id,
        inferenceIdB:   b.id,
        description:    desc,
        severity,
        resolution:     "unresolved",
        resolutionNote: null,
        detectedAt:     now,
      });
    }
  }

  return contradictions;
}

/**
 * Avalia um risco jurídico e calcula riskScore e level.
 * level: score >= 0.7 → "critical", >= 0.5 → "high", >= 0.3 → "medium", >= 0.1 → "low", else → "none"
 * replayKey = sha256(organizationId + riskType + affectedSection + description)
 */
export function assessLegalRisk(params: {
  organizationId: number;
  riskType: LegalRisk["riskType"];
  description: string;
  affectedSection: string;
  legalBasis?: string | null;
  mitigationSuggestion: string;
  probability: number;
  impact: number;
}): LegalRisk {
  const probability = clamp01(params.probability);
  const impact      = clamp01(params.impact);
  const riskScore   = probability * impact;

  const level: LegalRiskLevel =
    riskScore >= 0.7 ? "critical"
    : riskScore >= 0.5 ? "high"
    : riskScore >= 0.3 ? "medium"
    : riskScore >= 0.1 ? "low"
    : "none";

  const replayKey = sha256Hex(
    `${params.organizationId}${params.riskType}${params.affectedSection}${params.description}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    organizationId:      params.organizationId,
    riskType:            params.riskType,
    level,
    description:         params.description,
    affectedSection:     params.affectedSection,
    legalBasis:          params.legalBasis ?? null,
    mitigationSuggestion: params.mitigationSuggestion,
    probability,
    impact,
    riskScore,
    isResolved:          false,
    replayKey,
    createdAt:           new Date().toISOString(),
  };
}

/**
 * Cria uma recomendação jurídica com replayKey determinístico.
 * replayKey = sha256(organizationId + recommendationType + title + legalBasis)
 */
export function createLegalRecommendation(params: {
  organizationId: number;
  recommendationType: LegalRecommendation["recommendationType"];
  title: string;
  description: string;
  legalBasis: string;
  priority: LegalRecommendation["priority"];
  evidenceRefs: string[];
  confidence: number;
}): LegalRecommendation {
  const replayKey = sha256Hex(
    `${params.organizationId}${params.recommendationType}${params.title}${params.legalBasis}`,
  );
  const id = deterministicId(replayKey);

  return {
    id,
    organizationId:     params.organizationId,
    recommendationType: params.recommendationType,
    title:              params.title,
    description:        params.description,
    legalBasis:         params.legalBasis,
    priority:           params.priority,
    evidenceRefs:       params.evidenceRefs,
    confidence:         clamp01(params.confidence),
    replayKey,
    createdAt:          new Date().toISOString(),
  };
}

/**
 * Computa o status geral de conformidade de uma lista de checks.
 * Se vazio → "unknown"; se algum "non_compliant" com error → "non_compliant";
 * se todos "compliant" → "compliant"; else → "partial"
 */
export function computeOverallCompliance(checks: ComplianceCheck[]): ComplianceStatus {
  if (checks.length === 0) return "unknown";
  const hasErrorNonCompliant = checks.some(
    c => c.status === "non_compliant" && c.severity === "error",
  );
  if (hasErrorNonCompliant) return "non_compliant";
  const allCompliant = checks.every(c => c.status === "compliant");
  if (allCompliant) return "compliant";
  return "partial";
}

/**
 * Cria um trace completo de raciocínio jurídico.
 * overallCompliance = lógica baseada nos checks.
 * overallConfidence = média ponderada das inferências (índice maior = peso maior).
 * replayKey = sha256(sessionId + documentId + sorted(inferences.map(i=>i.replayKey)).join)
 */
export function createLegalReasoningTrace(
  organizationId:  number,
  sessionId:       string,
  documentId:      string,
  inferences:      LegalInference[],
  checks:          ComplianceCheck[],
  risks:           LegalRisk[],
  recommendations: LegalRecommendation[],
): LegalReasoningTrace {
  const contradictions  = detectLegalContradictions(inferences);
  const overallCompliance = computeOverallCompliance(checks);

  // Média ponderada: índice maior = peso maior (peso = index + 1)
  const totalWeight = inferences.reduce((acc, _, idx) => acc + (idx + 1), 0);
  const overallConfidence =
    inferences.length === 0
      ? 0
      : inferences.reduce((acc, inf, idx) => acc + inf.confidenceScore * (idx + 1), 0) / Math.max(totalWeight, 1);

  const criticalRisks = risks.filter(r => r.level === "critical").length;

  // Extrai estágios únicos presentes nas inferências
  const stagesSet = new Set<LegalReasoningStageType>(inferences.map(i => i.stageType));
  const stages: LegalReasoningStageType[] = Array.from(stagesSet);

  const sortedReplayKeys = [...inferences.map(i => i.replayKey)].sort().join("|");
  const replayKey = sha256Hex(`${sessionId}${documentId}${sortedReplayKeys}`);
  const id        = deterministicId(replayKey);

  return {
    id,
    organizationId,
    sessionId,
    documentId,
    stages,
    inferences,
    complianceChecks:  checks,
    contradictions,
    risks,
    recommendations,
    overallCompliance,
    overallConfidence: clamp01(overallConfidence),
    totalRisks:        risks.length,
    criticalRisks,
    replayKey,
    createdAt:         new Date().toISOString(),
  };
}

/**
 * Constrói grafo de dependência entre inferências.
 * Mapeia inferenceId → premiseIds (IDs que fundamentam a inferência).
 */
export function buildLegalDependencyGraph(
  inferences: LegalInference[],
): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const inf of inferences) {
    graph[inf.id] = [...inf.premiseIds];
  }
  return graph;
}

/**
 * Propaga confiança ao longo das inferências com decay factor 0.92.
 * Retorna NOVO array (imutável).
 * Inferências cujos premises existem no conjunto têm confiança ajustada.
 */
export function propagateLegalConfidence(
  inferences: LegalInference[],
): LegalInference[] {
  const DECAY = 0.92;
  const byId  = new Map<string, LegalInference>(inferences.map(i => [i.id, i]));

  return inferences.map(inf => {
    if (inf.premiseIds.length === 0) return inf;

    const premisesInSet = inf.premiseIds.filter(pid => byId.has(pid));
    if (premisesInSet.length === 0) return inf;

    const avgPremiseConfidence =
      premisesInSet.reduce((acc, pid) => acc + (byId.get(pid)?.confidenceScore ?? 0), 0)
      / premisesInSet.length;

    const propagated = clamp01(avgPremiseConfidence * DECAY);
    // Usa o menor valor entre score original e propagado (conservador)
    const newScore = Math.min(inf.confidenceScore, propagated);

    if (Math.abs(newScore - inf.confidenceScore) < 1e-9) return inf;

    const newLevel: LegalConfidenceLevel =
      newScore >= 0.85 ? "high"
      : newScore >= 0.65 ? "medium"
      : newScore >= 0.45 ? "low"
      : "uncertain";

    return { ...inf, confidenceScore: newScore, confidenceLevel: newLevel };
  });
}

/**
 * Formata um trace de raciocínio jurídico para auditoria em Markdown.
 */
export function formatLegalReasoningForAudit(trace: LegalReasoningTrace): string {
  const lines: string[] = [
    `# Trace de Raciocínio Jurídico`,
    ``,
    `**ID:** ${trace.id}`,
    `**Organização:** ${trace.organizationId}`,
    `**Sessão:** ${trace.sessionId}`,
    `**Documento:** ${trace.documentId}`,
    `**Criado em:** ${trace.createdAt}`,
    `**ReplayKey:** ${trace.replayKey}`,
    ``,
    `## Sumário Executivo`,
    ``,
    `| Métrica | Valor |`,
    `|---------|-------|`,
    `| Conformidade Geral | ${trace.overallCompliance} |`,
    `| Confiança Geral | ${(trace.overallConfidence * 100).toFixed(1)}% |`,
    `| Total de Riscos | ${trace.totalRisks} |`,
    `| Riscos Críticos | ${trace.criticalRisks} |`,
    `| Inferências | ${trace.inferences.length} |`,
    `| Checks de Conformidade | ${trace.complianceChecks.length} |`,
    `| Contradições | ${trace.contradictions.length} |`,
    `| Recomendações | ${trace.recommendations.length} |`,
    ``,
    `## Estágios Percorridos`,
    ``,
    trace.stages.length > 0
      ? trace.stages.map(s => `- ${s}`).join("\n")
      : "_Nenhum estágio registrado._",
    ``,
    `## Inferências Jurídicas`,
    ``,
  ];

  if (trace.inferences.length === 0) {
    lines.push("_Nenhuma inferência registrada._");
  } else {
    for (const inf of trace.inferences) {
      lines.push(
        `### [${inf.stageType}] ${inf.id}`,
        ``,
        `- **Conclusão:** ${inf.conclusion}`,
        `- **Confiança:** ${inf.confidenceLevel} (${(inf.confidenceScore * 100).toFixed(1)}%)`,
        `- **Base Legal:** ${inf.legalBasis}`,
        `- **Justificativa:** ${inf.justification}`,
        `- **Premises:** ${inf.premiseIds.join(", ") || "—"}`,
        `- **Contraditado:** ${inf.isContradicted ? "Sim" : "Não"}`,
        `- **ReplayKey:** ${inf.replayKey}`,
        ``,
      );
    }
  }

  lines.push(`## Checks de Conformidade`, ``);
  if (trace.complianceChecks.length === 0) {
    lines.push("_Nenhum check registrado._", ``);
  } else {
    for (const c of trace.complianceChecks) {
      lines.push(
        `### [${c.severity.toUpperCase()}] ${c.ruleRef}`,
        ``,
        `- **Status:** ${c.status}`,
        `- **Descrição:** ${c.description}`,
        c.mandatorySection ? `- **Seção Obrigatória:** ${c.mandatorySection}` : "",
        c.remediation ? `- **Remediação:** ${c.remediation}` : "",
        `- **ReplayKey:** ${c.replayKey}`,
        ``,
      );
    }
  }

  lines.push(`## Contradições Detectadas`, ``);
  if (trace.contradictions.length === 0) {
    lines.push("_Nenhuma contradição detectada._", ``);
  } else {
    for (const ct of trace.contradictions) {
      lines.push(
        `### [${ct.severity}] ${ct.id}`,
        ``,
        `- **Inferência A:** ${ct.inferenceIdA}`,
        `- **Inferência B:** ${ct.inferenceIdB}`,
        `- **Descrição:** ${ct.description}`,
        `- **Resolução:** ${ct.resolution}`,
        ct.resolutionNote ? `- **Nota:** ${ct.resolutionNote}` : "",
        ``,
      );
    }
  }

  lines.push(`## Riscos Jurídicos`, ``);
  if (trace.risks.length === 0) {
    lines.push("_Nenhum risco registrado._", ``);
  } else {
    for (const r of trace.risks) {
      lines.push(
        `### [${r.level.toUpperCase()}] ${r.riskType} — ${r.id}`,
        ``,
        `- **Descrição:** ${r.description}`,
        `- **Seção Afetada:** ${r.affectedSection}`,
        `- **Score:** ${r.riskScore.toFixed(3)} (P=${r.probability.toFixed(2)} × I=${r.impact.toFixed(2)})`,
        `- **Mitigação:** ${r.mitigationSuggestion}`,
        r.legalBasis ? `- **Base Legal:** ${r.legalBasis}` : "",
        `- **Resolvido:** ${r.isResolved ? "Sim" : "Não"}`,
        ``,
      );
    }
  }

  lines.push(`## Recomendações`, ``);
  if (trace.recommendations.length === 0) {
    lines.push("_Nenhuma recomendação gerada._", ``);
  } else {
    for (const rec of trace.recommendations) {
      lines.push(
        `### [${rec.priority.toUpperCase()}] ${rec.title}`,
        ``,
        `- **Tipo:** ${rec.recommendationType}`,
        `- **Descrição:** ${rec.description}`,
        `- **Base Legal:** ${rec.legalBasis}`,
        `- **Confiança:** ${(rec.confidence * 100).toFixed(1)}%`,
        `- **Evidências:** ${rec.evidenceRefs.join(", ") || "—"}`,
        ``,
      );
    }
  }

  return lines.filter(l => l !== undefined).join("\n");
}

// ─── Sprint 4.3: Extended Types & Inference Engine ───────────────────────────

export type InferenceType = "deductive" | "inductive" | "analogical" | "abductive";
export type RiskLevel = "critical" | "high" | "medium" | "low" | "negligible";
export type RecommendationType = "mandatory" | "advisory" | "optional" | "warning";

export interface LegalPremise {
  id: string;
  organizationId: number;
  content: string;
  legalBasis: string;       // e.g. "Lei 14133/2021 art. 6"
  confidence: number;       // 0-1
  sourceType: "statutory" | "regulatory" | "jurisprudential" | "doctrinal" | "contractual";
  isNegated: boolean;
  createdAt: string;
}

export interface ExtendedLegalInference {
  id: string;
  organizationId: number;
  traceId: string;
  premiseIds: string[];
  conclusion: string;
  inferenceType: InferenceType;
  confidence: number;
  legalBasis: string;
  justification: string;
  createdAt: string;
}

export interface ExtendedComplianceCheck {
  id: string;
  organizationId: number;
  traceId: string;
  ruleId: string;
  ruleName: string;
  legalBasis: string;
  status: "compliant" | "non_compliant" | "uncertain" | "not_applicable";
  findings: string;
  evidence: string[];
  remediation: string | null;
  checkScore: number;  // 0-1
  createdAt: string;
}

export interface PremiseContradiction {
  id: string;
  organizationId: number;
  traceId: string;
  premiseIdA: string;
  premiseIdB: string;
  description: string;
  severity: RiskLevel;
  resolution: string | null;
  createdAt: string;
}

export interface ExtendedLegalRisk {
  id: string;
  organizationId: number;
  traceId: string;
  riskType: string;
  description: string;
  level: RiskLevel;
  legalBasis: string;
  probability: number;   // 0-1
  impact: number;        // 0-1
  riskScore: number;     // probability * impact
  mitigations: string[];
  createdAt: string;
}

export interface ExtendedLegalRecommendation {
  id: string;
  organizationId: number;
  traceId: string;
  type: RecommendationType;
  content: string;
  legalBasis: string;
  priority: number;  // 1 = highest
  rationale: string;
  createdAt: string;
}

export interface ExtendedLegalReasoningTrace {
  id: string;
  organizationId: number;
  sessionId: string;
  premises: LegalPremise[];
  inferences: ExtendedLegalInference[];
  complianceChecks: ExtendedComplianceCheck[];
  contradictions: PremiseContradiction[];
  risks: ExtendedLegalRisk[];
  recommendations: ExtendedLegalRecommendation[];
  overallComplianceScore: number;  // 0-1 weighted average of checks
  overallRiskScore: number;        // 0-1 max risk score
  replayKey: string;
  createdAt: string;
}

// ─── Sprint 4.3: Factory functions ───────────────────────────────────────────

export function createLegalPremise(params: {
  organizationId: number;
  content: string;
  legalBasis: string;
  confidence?: number;
  sourceType?: LegalPremise["sourceType"];
  isNegated?: boolean;
}): LegalPremise {
  const now = new Date().toISOString();
  const id = sha256Hex(`premise:${params.organizationId}:${params.content}:${params.legalBasis}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    content: params.content,
    legalBasis: params.legalBasis,
    confidence: params.confidence ?? 1.0,
    sourceType: params.sourceType ?? "statutory",
    isNegated: params.isNegated ?? false,
    createdAt: now,
  };
}

export function createExtendedLegalInference(params: {
  organizationId: number;
  traceId: string;
  premiseIds: string[];
  conclusion: string;
  inferenceType: InferenceType;
  confidence?: number;
  legalBasis: string;
  justification: string;
}): ExtendedLegalInference {
  const now = new Date().toISOString();
  const id = sha256Hex(`einference:${params.organizationId}:${params.traceId}:${params.conclusion}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    traceId: params.traceId,
    premiseIds: params.premiseIds,
    conclusion: params.conclusion,
    inferenceType: params.inferenceType,
    confidence: params.confidence ?? 1.0,
    legalBasis: params.legalBasis,
    justification: params.justification,
    createdAt: now,
  };
}

export function createExtendedComplianceCheck(params: {
  organizationId: number;
  traceId: string;
  ruleId: string;
  ruleName: string;
  legalBasis: string;
  status: ExtendedComplianceCheck["status"];
  findings: string;
  evidence?: string[];
  remediation?: string | null;
  checkScore?: number;
}): ExtendedComplianceCheck {
  const now = new Date().toISOString();
  const id = sha256Hex(`ecompliance:${params.organizationId}:${params.traceId}:${params.ruleId}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    traceId: params.traceId,
    ruleId: params.ruleId,
    ruleName: params.ruleName,
    legalBasis: params.legalBasis,
    status: params.status,
    findings: params.findings,
    evidence: params.evidence ?? [],
    remediation: params.remediation ?? null,
    checkScore: params.checkScore ?? (params.status === "compliant" ? 1.0 : params.status === "uncertain" ? 0.5 : 0.0),
    createdAt: now,
  };
}

export function createPremiseContradiction(params: {
  organizationId: number;
  traceId: string;
  premiseIdA: string;
  premiseIdB: string;
  description: string;
  severity?: RiskLevel;
  resolution?: string | null;
}): PremiseContradiction {
  const now = new Date().toISOString();
  const id = sha256Hex(`pcontradiction:${params.organizationId}:${params.traceId}:${params.premiseIdA}:${params.premiseIdB}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    traceId: params.traceId,
    premiseIdA: params.premiseIdA,
    premiseIdB: params.premiseIdB,
    description: params.description,
    severity: params.severity ?? "medium",
    resolution: params.resolution ?? null,
    createdAt: now,
  };
}

export function createExtendedLegalRisk(params: {
  organizationId: number;
  traceId: string;
  riskType: string;
  description: string;
  level: RiskLevel;
  legalBasis: string;
  probability: number;
  impact: number;
  mitigations?: string[];
}): ExtendedLegalRisk {
  const now = new Date().toISOString();
  const id = sha256Hex(`erisk:${params.organizationId}:${params.traceId}:${params.riskType}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    traceId: params.traceId,
    riskType: params.riskType,
    description: params.description,
    level: params.level,
    legalBasis: params.legalBasis,
    probability: params.probability,
    impact: params.impact,
    riskScore: params.probability * params.impact,
    mitigations: params.mitigations ?? [],
    createdAt: now,
  };
}

export function createExtendedLegalRecommendation(params: {
  organizationId: number;
  traceId: string;
  type: RecommendationType;
  content: string;
  legalBasis: string;
  priority?: number;
  rationale: string;
}): ExtendedLegalRecommendation {
  const now = new Date().toISOString();
  const id = sha256Hex(`erecommendation:${params.organizationId}:${params.traceId}:${params.content}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    traceId: params.traceId,
    type: params.type,
    content: params.content,
    legalBasis: params.legalBasis,
    priority: params.priority ?? 1,
    rationale: params.rationale,
    createdAt: now,
  };
}

export function createExtendedLegalReasoningTrace(params: {
  organizationId: number;
  sessionId: string;
  premises?: LegalPremise[];
  inferences?: ExtendedLegalInference[];
  complianceChecks?: ExtendedComplianceCheck[];
  contradictions?: PremiseContradiction[];
  risks?: ExtendedLegalRisk[];
  recommendations?: ExtendedLegalRecommendation[];
}): ExtendedLegalReasoningTrace {
  const now = new Date().toISOString();
  const premises = params.premises ?? [];
  const inferences = params.inferences ?? [];
  const complianceChecks = params.complianceChecks ?? [];
  const contradictions = params.contradictions ?? [];
  const risks = params.risks ?? [];
  const recommendations = params.recommendations ?? [];

  const overallComplianceScore = assessExtendedComplianceScore(complianceChecks);
  const overallRiskScore = risks.length > 0 ? Math.max(...risks.map(r => r.riskScore)) : 0;

  const sortedPremises = [...premises].sort((a, b) => a.id.localeCompare(b.id));
  const sortedInferences = [...inferences].sort((a, b) => a.id.localeCompare(b.id));
  const replayKey = sha256Hex(JSON.stringify({
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    premises: sortedPremises,
    inferences: sortedInferences,
  })).slice(0, 40);

  const id = sha256Hex(`etrace:${params.organizationId}:${params.sessionId}:${now}`).slice(0, 20);

  return {
    id,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    premises,
    inferences,
    complianceChecks,
    contradictions,
    risks,
    recommendations,
    overallComplianceScore,
    overallRiskScore,
    replayKey,
    createdAt: now,
  };
}

export function detectPremiseContradictions(premises: LegalPremise[]): PremiseContradiction[] {
  const contradictions: PremiseContradiction[] = [];
  const organizationId = premises[0]?.organizationId ?? 0;

  for (let i = 0; i < premises.length; i++) {
    for (let j = i + 1; j < premises.length; j++) {
      const a = premises[i];
      const b = premises[j];
      if (a.legalBasis === b.legalBasis && a.isNegated !== b.isNegated) {
        const now = new Date().toISOString();
        const id = sha256Hex(`pcontra:${organizationId}::${a.id}:${b.id}:${now}`).slice(0, 20);
        contradictions.push({
          id,
          organizationId,
          traceId: "",
          premiseIdA: a.id,
          premiseIdB: b.id,
          description: `Contradição: premissa "${a.content.slice(0, 50)}..." e premissa negada "${b.content.slice(0, 50)}..." compartilham base legal "${a.legalBasis}"`,
          severity: "high",
          resolution: null,
          createdAt: now,
        });
      }
    }
  }

  return contradictions;
}

export function assessExtendedComplianceScore(checks: ExtendedComplianceCheck[]): number {
  const applicable = checks.filter(c => c.status !== "not_applicable");
  if (applicable.length === 0) return 1.0;
  const scoreMap: Record<ExtendedComplianceCheck["status"], number> = {
    compliant: 1.0,
    uncertain: 0.5,
    non_compliant: 0.0,
    not_applicable: 1.0,
  };
  const total = applicable.reduce((acc, c) => acc + scoreMap[c.status], 0);
  return total / applicable.length;
}

const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  negligible: 1,
};

export function prioritizeExtendedRisks(risks: ExtendedLegalRisk[]): ExtendedLegalRisk[] {
  return [...risks].sort((a, b) => {
    if (Math.abs(b.riskScore - a.riskScore) > 1e-9) return b.riskScore - a.riskScore;
    return RISK_LEVEL_ORDER[b.level] - RISK_LEVEL_ORDER[a.level];
  });
}

export function buildExtendedReasoningExplainability(trace: ExtendedLegalReasoningTrace): string {
  const compliancePct = (trace.overallComplianceScore * 100).toFixed(1);

  const riskCountByLevel: Record<RiskLevel, number> = {
    critical: 0, high: 0, medium: 0, low: 0, negligible: 0,
  };
  for (const r of trace.risks) {
    riskCountByLevel[r.level] += 1;
  }

  const topRecs = [...trace.recommendations]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);

  const lines: string[] = [
    `## Explicabilidade do Raciocínio Jurídico`,
    ``,
    `### Premissas`,
    `- Total de premissas: **${trace.premises.length}**`,
    ``,
    `### Inferências`,
    `- Total de inferências: **${trace.inferences.length}**`,
    ``,
    `### Conformidade`,
    `- Pontuação geral: **${compliancePct}%**`,
    `- Verificações realizadas: **${trace.complianceChecks.length}**`,
    ``,
    `### Riscos Identificados`,
    `- Crítico: **${riskCountByLevel.critical}**`,
    `- Alto: **${riskCountByLevel.high}**`,
    `- Médio: **${riskCountByLevel.medium}**`,
    `- Baixo: **${riskCountByLevel.low}**`,
    `- Negligível: **${riskCountByLevel.negligible}**`,
    ``,
    `### Principais Recomendações`,
  ];

  if (topRecs.length === 0) {
    lines.push(`- Nenhuma recomendação gerada.`);
  } else {
    for (const rec of topRecs) {
      lines.push(`- [${rec.type.toUpperCase()}] ${rec.content.slice(0, 100)}${rec.content.length > 100 ? "..." : ""}`);
    }
  }

  return lines.join("\n");
}

// ─── Sprint 4.3: Canonical-name aliases & re-exports for service layer ────────
// The service layer (legalReasoningEngine.ts) imports using the spec canonical names.
// These aliases bridge the extended Sprint 4.3 implementations to those names.

/** Sprint 4.3 canonical LegalReasoningTrace type (with premises & extended fields) */
export type { ExtendedLegalReasoningTrace as LegalReasoningTraceV2 };

/** Sprint 4.3 canonical ComplianceCheck (with ruleId, ruleName, legalBasis, findings) */
export type { ExtendedComplianceCheck as ComplianceCheckV2 };

/** Sprint 4.3 canonical LegalRisk (with mitigations, legalBasis string) */
export type { ExtendedLegalRisk as LegalRiskV2 };

/** Sprint 4.3 canonical LegalRecommendation (with traceId, type, content, priority, rationale) */
export type { ExtendedLegalRecommendation as LegalRecommendationV2 };

/** @alias createExtendedLegalInference — Sprint 4.3 signature */
export const createLegalInferenceV2 = createExtendedLegalInference;

/** @alias createExtendedComplianceCheck — Sprint 4.3 signature */
export const createComplianceCheckV2 = createExtendedComplianceCheck;

/** @alias createExtendedLegalRisk — Sprint 4.3 signature */
export const createLegalRisk = createExtendedLegalRisk;

/** @alias createExtendedLegalRecommendation — Sprint 4.3 signature */
export const createLegalRecommendationV2 = createExtendedLegalRecommendation;

/** @alias createExtendedLegalReasoningTrace — Sprint 4.3 object-param signature */
export const createLegalReasoningTraceV2 = createExtendedLegalReasoningTrace;

/** @alias detectPremiseContradictions */
export const detectPremiseContradictionsAlias = detectPremiseContradictions;

/** @alias assessExtendedComplianceScore */
export const assessComplianceScore = assessExtendedComplianceScore;

/** @alias prioritizeExtendedRisks */
export const prioritizeRisks = prioritizeExtendedRisks;

/** @alias buildExtendedReasoningExplainability */
export const buildReasoningExplainability = buildExtendedReasoningExplainability;
