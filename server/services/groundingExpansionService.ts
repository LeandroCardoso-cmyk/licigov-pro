import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GroundingSource {
  id: string;
  organizationId: number;
  sourceType: "legal_text" | "precedent" | "document" | "institutional" | "external_ref";
  content: string;
  citation: string;
  authority: number;
  relevanceScore: number;
  legalBasis: string | null;
  provenance: string[];
  isVerified: boolean;
  replayKey: string;
}

export interface GroundingExpansion {
  id: string;
  organizationId: number;
  query: string;
  sources: GroundingSource[];
  citationChain: string[];
  provenanceGraph: Record<string, string[]>;
  hallucinationRiskScore: number;
  groundingConfidence: number;
  replayKey: string;
  expandedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function genId(input: string): string {
  return sha256(input).slice(0, 20);
}

// ─── Service functions ────────────────────────────────────────────────────────

export function createGroundingSource(params: {
  organizationId: number;
  sourceType: GroundingSource["sourceType"];
  content: string;
  citation: string;
  authority: number;
  relevanceScore: number;
  legalBasis?: string | null;
  provenance?: string[];
  isVerified?: boolean;
}): GroundingSource {
  const replayKey = sha256(`${params.citation}${params.content}${params.organizationId}`);
  return {
    id:            genId(replayKey),
    organizationId: params.organizationId,
    sourceType:    params.sourceType,
    content:       params.content,
    citation:      params.citation,
    authority:     params.authority,
    relevanceScore: params.relevanceScore,
    legalBasis:    params.legalBasis ?? null,
    provenance:    params.provenance ?? [],
    isVerified:    params.isVerified ?? false,
    replayKey,
  };
}

export function rankSources(sources: GroundingSource[]): GroundingSource[] {
  return [...sources].sort((a, b) => {
    // Sort by authority desc, then relevanceScore desc, then citation asc (deterministic)
    if (b.authority !== a.authority) return b.authority - a.authority;
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    return a.citation.localeCompare(b.citation);
  });
}

export function buildProvenanceGraph(sources: GroundingSource[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const source of sources) {
    graph[source.id] = source.provenance;
  }
  return graph;
}

export function computeHallucinationRisk(sources: GroundingSource[]): number {
  if (sources.length === 0) return 1.0;

  const avg =
    sources.reduce((sum, s) => sum + s.authority * (s.isVerified ? 1 : 0.5), 0) /
    sources.length;

  return Math.max(0, Math.min(1, 1 - avg));
}

export function expandGrounding(
  organizationId: number,
  query: string,
  initialSources: GroundingSource[],
): GroundingExpansion {
  const now = new Date().toISOString();

  const ranked = rankSources(initialSources);
  const citationChain = ranked.map(s => s.citation);
  const provenanceGraph = buildProvenanceGraph(ranked);
  const hallucinationRiskScore = computeHallucinationRisk(ranked);

  const groundingConfidence =
    ranked.length > 0
      ? ranked.reduce((sum, s) => sum + s.relevanceScore * (s.isVerified ? 1 : 0.7), 0) /
        ranked.length
      : 0;

  const sortedSourceIds = [...ranked.map(s => s.id)].sort().join(",");
  const replayKey = sha256(`${query}${sortedSourceIds}`);

  return {
    id:                    genId(replayKey),
    organizationId,
    query,
    sources:               ranked,
    citationChain,
    provenanceGraph,
    hallucinationRiskScore,
    groundingConfidence,
    replayKey,
    expandedAt:            now,
  };
}
