import { createHash } from "crypto";

export type IndexedEntityType =
  | "tr"
  | "item_tr"
  | "clause"
  | "justification"
  | "parecer"
  | "catmat"
  | "workflow"
  | "semantic_memory"
  | "explainability_chain";

export interface SemanticIndexEntry {
  id: string;
  organizationId: number;
  entityId: string;
  entityType: IndexedEntityType;
  content: string;
  tokens: string[];
  semanticAliases: string[];
  institutionalSynonyms: string[];
  legalTerms: string[];
  contextualAssociations: string[];
  semanticLineage: string[];
  indexHash: string;
  tokenMap: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface IndexStats {
  organizationId: number;
  totalEntries: number;
  byEntityType: Record<IndexedEntityType, number>;
  avgTokensPerEntry: number;
  totalUniqueTokens: number;
  topTokens: Array<{ token: string; frequency: number }>;
}

const STOPWORDS_PT = new Set([
  "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "a", "o", "as", "os", "um", "uma", "e", "ou", "que", "para",
  "com", "por", "se", "ao", "à", "são", "mais", "pelo", "pela",
  "ser", "ter", "foi", "ele", "ela", "seu", "sua", "isso", "este",
  "esta", "esse", "essa", "num", "nos", "também",
]);

const _indexStore = new Map<number, SemanticIndexEntry[]>();

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-záéíóúâêîôûãõàçü0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS_PT.has(t));
}

function buildTokenMap(tokens: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const t of tokens) {
    map[t] = (map[t] ?? 0) + 1;
  }
  return map;
}

function topNTokens(tokenMap: Record<string, number>, n: number): string[] {
  return Object.entries(tokenMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([token]) => token);
}

export function indexEntity(params: {
  organizationId: number;
  entityId: string;
  entityType: IndexedEntityType;
  content: string;
  semanticAliases?: string[];
  institutionalSynonyms?: string[];
  legalTerms?: string[];
}): SemanticIndexEntry {
  const now = new Date().toISOString();
  const tokens = tokenize(params.content);
  const tokenMap = buildTokenMap(tokens);
  const contextualAssociations = topNTokens(tokenMap, 5);
  const indexHash = sha20(params.content + params.entityType);
  const id = sha20(
    `${params.organizationId}${params.entityId}${params.entityType}${indexHash}`
  );

  const entry: SemanticIndexEntry = {
    id,
    organizationId: params.organizationId,
    entityId: params.entityId,
    entityType: params.entityType,
    content: params.content,
    tokens,
    semanticAliases: params.semanticAliases ?? [],
    institutionalSynonyms: params.institutionalSynonyms ?? [],
    legalTerms: params.legalTerms ?? [],
    contextualAssociations,
    semanticLineage: [],
    indexHash,
    tokenMap,
    createdAt: now,
    updatedAt: now,
  };

  const store = _indexStore.get(params.organizationId) ?? [];
  store.push(entry);
  _indexStore.set(params.organizationId, store);

  return entry;
}

export function updateIndex(
  entry: SemanticIndexEntry,
  newContent: string
): SemanticIndexEntry {
  const now = new Date().toISOString();
  const tokens = tokenize(newContent);
  const tokenMap = buildTokenMap(tokens);
  const contextualAssociations = topNTokens(tokenMap, 5);
  const indexHash = sha20(newContent + entry.entityType);
  const newLineage = [...entry.semanticLineage, entry.id];
  const newId = sha20(
    `${entry.organizationId}${entry.entityId}${entry.entityType}${indexHash}${now}`
  );

  const updated: SemanticIndexEntry = {
    ...entry,
    id: newId,
    content: newContent,
    tokens,
    tokenMap,
    contextualAssociations,
    indexHash,
    semanticLineage: newLineage,
    updatedAt: now,
  };

  const store = _indexStore.get(entry.organizationId) ?? [];
  const filtered = store.filter((e) => e.id !== entry.id);
  filtered.push(updated);
  _indexStore.set(entry.organizationId, filtered);

  return updated;
}

export function searchIndex(
  organizationId: number,
  query: string,
  limit = 10
): SemanticIndexEntry[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const store = _indexStore.get(organizationId) ?? [];

  const scored = store.map((entry) => {
    const entryTokenSet = new Set(entry.tokens);
    const intersection = queryTokens.filter((t) => entryTokenSet.has(t)).length;
    const denominator = Math.max(queryTokens.length, entry.tokens.length);
    const score = denominator === 0 ? 0 : intersection / denominator;
    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}

export function getIndexStats(organizationId: number): IndexStats {
  const store = _indexStore.get(organizationId) ?? [];

  const byEntityType = {
    tr: 0,
    item_tr: 0,
    clause: 0,
    justification: 0,
    parecer: 0,
    catmat: 0,
    workflow: 0,
    semantic_memory: 0,
    explainability_chain: 0,
  } as Record<IndexedEntityType, number>;

  const globalTokenFreq = new Map<string, number>();
  let totalTokens = 0;

  for (const entry of store) {
    byEntityType[entry.entityType] = (byEntityType[entry.entityType] ?? 0) + 1;
    totalTokens += entry.tokens.length;
    for (const [token, freq] of Object.entries(entry.tokenMap)) {
      globalTokenFreq.set(token, (globalTokenFreq.get(token) ?? 0) + freq);
    }
  }

  const topTokens = Array.from(globalTokenFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([token, frequency]) => ({ token, frequency }));

  return {
    organizationId,
    totalEntries: store.length,
    byEntityType,
    avgTokensPerEntry: store.length === 0 ? 0 : Math.round(totalTokens / store.length),
    totalUniqueTokens: globalTokenFreq.size,
    topTokens,
  };
}
