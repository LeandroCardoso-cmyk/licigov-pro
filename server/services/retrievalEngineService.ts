import { createHash } from "crypto";

export type RetrievalStrategy =
  | "lexical"
  | "semantic"
  | "hybrid"
  | "contextual"
  | "institutional"
  | "historical";

export interface RetrievalQuery {
  id: string;
  organizationId: number;
  queryText: string;
  strategy: RetrievalStrategy;
  filters: {
    documentTypes?: string[];
    workflowStage?: string;
    minConfidence?: number;
    dateRange?: { from: string; to: string };
  };
  maxResults: number;
  replayKey: string;
  createdAt: string;
}

export interface RetrievalResult {
  id: string;
  queryId: string;
  organizationId: number;
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  contextualScore: number;
  institutionalScore: number;
  rank: number;
  explanation: string;
  retrievedAt: string;
}

export interface RetrievalResponse {
  queryId: string;
  organizationId: number;
  results: RetrievalResult[];
  totalFound: number;
  strategy: RetrievalStrategy;
  durationMs: number;
  replayKey: string;
}

export interface CorpusItem {
  id: string;
  documentId: string;
  content: string;
  metadata: Record<string, unknown>;
}

const _queryHistory = new Map<number, RetrievalQuery[]>();

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function sortedJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(sortedJsonStringify).join(",") + "]";
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + sortedJsonStringify((obj as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2);
}

function computeLexicalScore(queryTokens: string[], content: string): number {
  if (queryTokens.length === 0) return 0;
  const contentLower = content.toLowerCase();
  const matched = queryTokens.filter((t) => contentLower.includes(t));
  return matched.length / queryTokens.length;
}

function computeSemanticScoreMock(queryText: string, content: string): number {
  const combined = queryText + "|" + content;
  const hash = createHash("sha256").update(combined).digest("hex");
  const val = parseInt(hash.slice(0, 8), 16);
  return (val % 1000) / 1000;
}

function computeContextualScore(
  item: CorpusItem,
  filters: RetrievalQuery["filters"]
): number {
  if (!filters.workflowStage) return 0.5;
  const stage = item.metadata["workflowStage"] as string | undefined;
  return stage === filters.workflowStage ? 0.9 : 0.4;
}

function computeInstitutionalScore(item: CorpusItem): number {
  const meta = item.metadata;
  if (
    typeof meta["institucional"] === "boolean" && meta["institucional"] === true
  ) {
    return 0.8;
  }
  const content = item.content.toLowerCase();
  if (content.includes("institucional")) return 0.8;
  return 0.5;
}

export function createQuery(params: {
  organizationId: number;
  queryText: string;
  strategy: RetrievalStrategy;
  filters?: RetrievalQuery["filters"];
  maxResults?: number;
}): RetrievalQuery {
  const filters = params.filters ?? {};
  const maxResults = params.maxResults ?? 10;
  const createdAt = new Date().toISOString();

  const replaySource = sortedJsonStringify({
    organizationId: params.organizationId,
    queryText: params.queryText,
    strategy: params.strategy,
    filters,
    maxResults,
  });
  const replayKey = sha20(replaySource);
  const id = sha20(`${params.organizationId}${params.queryText}${params.strategy}${replayKey}`);

  const query: RetrievalQuery = {
    id,
    organizationId: params.organizationId,
    queryText: params.queryText,
    strategy: params.strategy,
    filters,
    maxResults,
    replayKey,
    createdAt,
  };

  const history = _queryHistory.get(params.organizationId) ?? [];
  history.push(query);
  _queryHistory.set(params.organizationId, history);

  return query;
}

export function executeRetrieval(
  query: RetrievalQuery,
  corpus: CorpusItem[]
): RetrievalResponse {
  const start = Date.now();
  const now = new Date().toISOString();
  const queryTokens = tokenizeQuery(query.queryText);

  const scored = corpus.map((item) => {
    const lexicalScore = computeLexicalScore(queryTokens, item.content);
    const semanticScore = computeSemanticScoreMock(query.queryText, item.content);
    const contextualScore = computeContextualScore(item, query.filters);
    const institutionalScore = computeInstitutionalScore(item);
    const score =
      lexicalScore * 0.35 +
      semanticScore * 0.35 +
      contextualScore * 0.15 +
      institutionalScore * 0.15;

    return { item, lexicalScore, semanticScore, contextualScore, institutionalScore, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const topScored = scored.slice(0, query.maxResults);

  const results: RetrievalResult[] = topScored.map((entry, idx) => {
    const resultId = sha20(`${query.id}${entry.item.id}${idx}`);
    const explanation =
      `Recuperado via ${query.strategy}: lexical=${entry.lexicalScore.toFixed(2)}, ` +
      `semantic=${entry.semanticScore.toFixed(2)}, contextual=${entry.contextualScore.toFixed(2)}, ` +
      `institutional=${entry.institutionalScore.toFixed(2)}, final=${entry.score.toFixed(2)}`;
    return {
      id: resultId,
      queryId: query.id,
      organizationId: query.organizationId,
      chunkId: entry.item.id,
      documentId: entry.item.documentId,
      content: entry.item.content,
      score: entry.score,
      lexicalScore: entry.lexicalScore,
      semanticScore: entry.semanticScore,
      contextualScore: entry.contextualScore,
      institutionalScore: entry.institutionalScore,
      rank: idx + 1,
      explanation,
      retrievedAt: now,
    };
  });

  const responseReplayKey = sha20(
    query.replayKey + corpus.map((c) => c.id).sort().join("")
  );

  return {
    queryId: query.id,
    organizationId: query.organizationId,
    results,
    totalFound: scored.filter((s) => s.score > 0).length,
    strategy: query.strategy,
    durationMs: Date.now() - start,
    replayKey: responseReplayKey,
  };
}

export function computeBM25Score(
  query: string,
  document: string,
  corpusSize = 100,
  avgDocLength = 200
): number {
  const k1 = 1.5;
  const b = 0.75;
  const queryTerms = tokenizeQuery(query);
  const docTokens = tokenizeQuery(document);
  const docLength = docTokens.length;
  const effectiveDocLen = docLength || 1;

  const termFreqMap = new Map<string, number>();
  for (const t of docTokens) {
    termFreqMap.set(t, (termFreqMap.get(t) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = termFreqMap.get(term) ?? 0;
    const df = tf > 0 ? 1 : 0;
    const idf = Math.log((corpusSize - df + 0.5) / (df + 0.5) + 1);
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (effectiveDocLen / avgDocLength));
    score += idf * (numerator / denominator);
  }

  const maxPossibleScore = queryTerms.length * Math.log(corpusSize + 1) * (k1 + 1);
  if (maxPossibleScore === 0) return 0;
  return Math.min(1, score / maxPossibleScore);
}
