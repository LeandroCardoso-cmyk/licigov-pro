import { createHash } from "crypto";

export interface RetrievalTrace {
  id: string;
  organizationId: number;
  sessionId: string;
  query: string;
  strategy: string;
  stageBreakdown: Record<string, number>;
  totalScore: number;
  rankPosition: number;
  itemId: string;
  semanticMatchReason: string;
  contextualMatchReason: string;
  institutionalRelevanceReason: string;
  legalRelevanceReason: string;
  historicalRelevanceReason: string;
  workflowRelevanceReason: string;
  confidencePropagationPath: string[];
  evidenceLineage: string[];
  replayKey: string;
  createdAt: string;
}

export interface ExplainabilityTree {
  rootItemId: string;
  organizationId: number;
  query: string;
  branches: Array<{
    label: string;
    score: number;
    explanation: string;
    subBranches: Array<{ label: string; score: number; explanation: string }>;
  }>;
  overallExplanation: string;
  markdownSummary: string;
}

export interface RankingLineage {
  sessionId: string;
  organizationId: number;
  items: Array<{ itemId: string; finalScore: number; rankPosition: number; trace: RetrievalTrace }>;
  totalItems: number;
  createdAt: string;
}

const _traces = new Map<string, RetrievalTrace[]>();

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function traceStoreKey(organizationId: number, sessionId: string): string {
  return `${organizationId}:${sessionId}`;
}

export function recordTrace(params: {
  organizationId: number;
  sessionId: string;
  query: string;
  strategy: string;
  itemId: string;
  stageBreakdown: Record<string, number>;
  rankPosition: number;
  semanticMatchReason: string;
  contextualMatchReason: string;
  institutionalRelevanceReason?: string;
  legalRelevanceReason?: string;
  historicalRelevanceReason?: string;
  workflowRelevanceReason?: string;
  evidenceLineage?: string[];
}): RetrievalTrace {
  const now = new Date().toISOString();
  const replayKey = sha20(`${params.sessionId}${params.query}${params.itemId}`);
  const id = sha20(`${params.organizationId}${replayKey}${params.rankPosition}`);

  const values = Object.values(params.stageBreakdown);
  const totalScore = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

  const trace: RetrievalTrace = {
    id,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    query: params.query,
    strategy: params.strategy,
    stageBreakdown: params.stageBreakdown,
    totalScore,
    rankPosition: params.rankPosition,
    itemId: params.itemId,
    semanticMatchReason: params.semanticMatchReason,
    contextualMatchReason: params.contextualMatchReason,
    institutionalRelevanceReason: params.institutionalRelevanceReason ?? "",
    legalRelevanceReason: params.legalRelevanceReason ?? "",
    historicalRelevanceReason: params.historicalRelevanceReason ?? "",
    workflowRelevanceReason: params.workflowRelevanceReason ?? "",
    confidencePropagationPath: [],
    evidenceLineage: params.evidenceLineage ?? [],
    replayKey,
    createdAt: now,
  };

  const key = traceStoreKey(params.organizationId, params.sessionId);
  const existing = _traces.get(key) ?? [];
  existing.push(trace);
  _traces.set(key, existing);

  return trace;
}

export function buildExplainabilityTree(
  trace: RetrievalTrace,
  context?: Record<string, unknown>
): ExplainabilityTree {
  const sd = trace.stageBreakdown;

  const semanticScore = sd["semantic"] ?? sd["semanticScore"] ?? 0;
  const contextualScore = sd["contextual"] ?? sd["contextualScore"] ?? 0;
  const institutionalScore = sd["institutional"] ?? sd["institutionalScore"] ?? 0;
  const legalScore = sd["legal"] ?? sd["legalScore"] ?? 0;

  const branches: ExplainabilityTree["branches"] = [
    {
      label: "Semântico",
      score: semanticScore,
      explanation: trace.semanticMatchReason,
      subBranches: [
        {
          label: "Correspondência de termos",
          score: semanticScore * 0.6,
          explanation: `Score semântico base: ${semanticScore.toFixed(3)}`,
        },
        {
          label: "Similaridade contextual",
          score: semanticScore * 0.4,
          explanation: context ? `Contexto adicional aplicado` : "Sem contexto adicional",
        },
      ],
    },
    {
      label: "Contextual",
      score: contextualScore,
      explanation: trace.contextualMatchReason,
      subBranches: [
        {
          label: "Stage do workflow",
          score: contextualScore * 0.5,
          explanation: trace.workflowRelevanceReason || "Stage não especificado",
        },
        {
          label: "Relevância histórica",
          score: contextualScore * 0.5,
          explanation: trace.historicalRelevanceReason || "Sem histórico relevante",
        },
      ],
    },
    {
      label: "Institucional",
      score: institutionalScore,
      explanation: trace.institutionalRelevanceReason,
      subBranches: [
        {
          label: "Score institucional",
          score: institutionalScore,
          explanation: `Relevância institucional: ${institutionalScore.toFixed(3)}`,
        },
      ],
    },
    {
      label: "Legal",
      score: legalScore,
      explanation: trace.legalRelevanceReason,
      subBranches: [
        {
          label: "Base legal",
          score: legalScore,
          explanation: `Relevância legal: ${legalScore.toFixed(3)}`,
        },
      ],
    },
  ];

  const overallExplanation =
    `Item ${trace.itemId} recuperado na posição ${trace.rankPosition} ` +
    `com score total ${trace.totalScore.toFixed(4)} via estratégia "${trace.strategy}".`;

  const markdownSummary = [
    `## Explicabilidade — Item \`${trace.itemId}\``,
    ``,
    `**Query:** ${trace.query}`,
    `**Estratégia:** ${trace.strategy}`,
    `**Score Total:** ${trace.totalScore.toFixed(4)}`,
    `**Posição:** #${trace.rankPosition}`,
    ``,
    `### Scores por Dimensão`,
    `| Dimensão | Score |`,
    `|----------|-------|`,
    ...branches.map((b) => `| ${b.label} | ${b.score.toFixed(4)} |`),
    ``,
    `### Evidências`,
    trace.evidenceLineage.length > 0
      ? trace.evidenceLineage.map((e) => `- \`${e}\``).join("\n")
      : "_Sem evidências registradas_",
  ].join("\n");

  return {
    rootItemId: trace.itemId,
    organizationId: trace.organizationId,
    query: trace.query,
    branches,
    overallExplanation,
    markdownSummary,
  };
}

export function buildRankingLineage(
  sessionId: string,
  organizationId: number,
  traces: RetrievalTrace[]
): RankingLineage {
  const sorted = [...traces].sort((a, b) => a.rankPosition - b.rankPosition);
  return {
    sessionId,
    organizationId,
    items: sorted.map((t) => ({
      itemId: t.itemId,
      finalScore: t.totalScore,
      rankPosition: t.rankPosition,
      trace: t,
    })),
    totalItems: sorted.length,
    createdAt: new Date().toISOString(),
  };
}

export function compareExplainabilities(a: RetrievalTrace, b: RetrievalTrace): string {
  const diff = a.totalScore - b.totalScore;
  const direction = diff > 0 ? "maior" : diff < 0 ? "menor" : "igual";
  const lines: string[] = [
    `Item A (${a.itemId}) teve score ${a.totalScore.toFixed(4)} vs B (${b.itemId}) com score ${b.totalScore.toFixed(4)}.`,
    `Diferença: ${Math.abs(diff).toFixed(4)} — A teve score ${direction} que B.`,
  ];

  const stagesA = Object.keys(a.stageBreakdown);
  const stagesB = Object.keys(b.stageBreakdown);
  const allStages = Array.from(new Set([...stagesA, ...stagesB]));

  for (const stage of allStages) {
    const va = a.stageBreakdown[stage] ?? 0;
    const vb = b.stageBreakdown[stage] ?? 0;
    if (Math.abs(va - vb) > 0.001) {
      lines.push(`  Dimensão "${stage}": A=${va.toFixed(4)}, B=${vb.toFixed(4)}`);
    }
  }

  if (a.semanticMatchReason !== b.semanticMatchReason) {
    lines.push(`  Razão semântica diferente: A="${a.semanticMatchReason}" vs B="${b.semanticMatchReason}"`);
  }

  return lines.join("\n");
}

export function formatForAudit(trace: RetrievalTrace): string {
  return [
    `# Trilha de Auditoria Forense`,
    ``,
    `**ID:** ${trace.id}`,
    `**Organização:** ${trace.organizationId}`,
    `**Sessão:** ${trace.sessionId}`,
    `**Item:** ${trace.itemId}`,
    `**Query:** ${trace.query}`,
    `**Estratégia:** ${trace.strategy}`,
    `**Score Total:** ${trace.totalScore.toFixed(6)}`,
    `**Posição:** #${trace.rankPosition}`,
    `**Criado em:** ${trace.createdAt}`,
    `**replayKey:** \`${trace.replayKey}\``,
    ``,
    `## Breakdown de Scores`,
    ...Object.entries(trace.stageBreakdown).map(
      ([k, v]) => `- **${k}:** ${v.toFixed(6)}`
    ),
    ``,
    `## Razões`,
    `- **Semântica:** ${trace.semanticMatchReason}`,
    `- **Contextual:** ${trace.contextualMatchReason}`,
    `- **Institucional:** ${trace.institutionalRelevanceReason}`,
    `- **Legal:** ${trace.legalRelevanceReason}`,
    `- **Histórica:** ${trace.historicalRelevanceReason}`,
    `- **Workflow:** ${trace.workflowRelevanceReason}`,
    ``,
    `## Cadeia de Confiança`,
    trace.confidencePropagationPath.length > 0
      ? trace.confidencePropagationPath.map((p) => `- ${p}`).join("\n")
      : "_Sem propagação registrada_",
    ``,
    `## Lineage de Evidências`,
    trace.evidenceLineage.length > 0
      ? trace.evidenceLineage.map((e) => `- \`${e}\``).join("\n")
      : "_Sem evidências_",
  ].join("\n");
}

export function getSessionTraces(organizationId: number, sessionId: string): RetrievalTrace[] {
  return _traces.get(traceStoreKey(organizationId, sessionId)) ?? [];
}
