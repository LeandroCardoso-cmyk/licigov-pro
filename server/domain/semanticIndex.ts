/**
 * Sprint 2.9 — Semantic Index.
 *
 * Índice de busca semântica para normalização de descrições de itens.
 * Suporta tokenização, aliases, sinônimos e tolerância a typos.
 *
 * ESCOPO: fundação de busca local — sem embeddings ou vetores nesta sprint.
 * O índice é construído em memória e pode ser serializado para persistência.
 */

import { nanoid } from "nanoid";

// ─── Index entry ──────────────────────────────────────────────────────────────

export interface SemanticSearchEntry {
  id:              string;
  organizationId:  number;

  // Texto canônico
  canonicalText:   string;       // forma normalizada oficial
  displayText:     string;       // forma para exibição ao usuário
  category?:       string;       // categoria (ex: "material", "serviço", "equipamento")
  subcategory?:    string;

  // Tokens de busca
  tokens:          string[];     // tokens normalizados do canonicalText
  aliases:         string[];     // variações conhecidas (ex: "mesa escritório", "mesa de trabalho")
  synonymTokens:   string[];     // tokens de todos os aliases

  // Metadados de qualidade
  frequency:       number;       // quantas vezes apareceu em sessões passadas
  lastSeenAt?:     string;       // ISO 8601
  source:          "manual" | "learned" | "catmat" | "imported";

  // CATMAT
  catmatCode?:     string;
  catmatGroup?:    string;
  catmatClass?:    string;

  // Versionamento
  createdAt:       string;
  updatedAt:       string;
  isActive:        boolean;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

const STOPWORDS_PT = new Set([
  "de", "da", "do", "das", "dos", "e", "ou", "em", "para", "por",
  "com", "sem", "a", "o", "as", "os", "um", "uma", "uns", "umas",
  "se", "que", "na", "no", "nas", "nos", "ao", "à", "pelo", "pela",
  "entre", "sobre", "após", "ante", "até", "desde",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // remove diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS_PT.has(t))
    .sort();
}

export function stemPt(token: string): string {
  // Stemming básico PT-BR (sufixos comuns)
  const rules: Array<[RegExp, string]> = [
    [/idades?$/, "idade"],
    [/amentos?$/, "amento"],
    [/imentos?$/, "imento"],
    [/adores?$/, "ador"],
    [/ações?$/, "acao"],
    [/mente$/, ""],
    [/veis?$/, "vel"],
    [/osos?$/, "oso"],
    [/ais?$/, "al"],
    [/eis?$/, "el"],
    [/[aeiou]s$/, (m) => m.slice(0, -1)],
  ];

  for (const [pattern, replacement] of rules) {
    if (typeof replacement === "string" && pattern.test(token)) {
      const result = token.replace(pattern, replacement);
      if (result.length >= 3) return result;
    }
  }
  return token;
}

// ─── Levenshtein distance (typo tolerance) ────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export function isFuzzyMatch(a: string, b: string, maxDistance = 2): boolean {
  if (Math.abs(a.length - b.length) > maxDistance) return false;
  return levenshtein(a, b) <= maxDistance;
}

// ─── Similarity scoring ───────────────────────────────────────────────────────

export interface TokenMatchResult {
  score:      number;
  matchedOn:  string[];
  strategy:   "exact" | "alias" | "token" | "fuzzy" | "prefix";
}

export function scoreAgainstEntry(
  queryTokens: string[],
  entry:       SemanticSearchEntry,
): TokenMatchResult {
  const canonTokens = entry.tokens;
  const allTokens   = [...canonTokens, ...entry.synonymTokens];

  // 1. Exact text match
  const queryText = queryTokens.sort().join(" ");
  const entryText = canonTokens.join(" ");
  if (queryText === entryText) {
    return { score: 1.0, matchedOn: queryTokens, strategy: "exact" };
  }

  // 2. Alias check
  for (const alias of entry.aliases) {
    const aliasTokens = tokenize(alias);
    if (aliasTokens.sort().join(" ") === queryText) {
      return { score: 0.95, matchedOn: queryTokens, strategy: "alias" };
    }
  }

  // 3. Token intersection
  const matchedTokens = queryTokens.filter(qt => allTokens.includes(qt));
  if (matchedTokens.length > 0) {
    const union = new Set([...queryTokens, ...canonTokens]).size;
    const jaccardScore = matchedTokens.length / union;
    if (jaccardScore >= 0.5) {
      return { score: 0.60 + jaccardScore * 0.30, matchedOn: matchedTokens, strategy: "token" };
    }
  }

  // 4. Prefix match
  const prefixMatches = queryTokens.filter(qt =>
    allTokens.some(et => et.startsWith(qt) || qt.startsWith(et)),
  );
  if (prefixMatches.length >= Math.ceil(queryTokens.length * 0.6)) {
    return { score: 0.55, matchedOn: prefixMatches, strategy: "prefix" };
  }

  // 5. Fuzzy token match
  const fuzzyMatches = queryTokens.filter(qt =>
    allTokens.some(et => isFuzzyMatch(qt, et, 2)),
  );
  if (fuzzyMatches.length >= Math.ceil(queryTokens.length * 0.5)) {
    return { score: 0.40 + (fuzzyMatches.length / queryTokens.length) * 0.20, matchedOn: fuzzyMatches, strategy: "fuzzy" };
  }

  return { score: 0, matchedOn: [], strategy: "exact" };
}

// ─── In-memory semantic index ─────────────────────────────────────────────────

export class SemanticIndex {
  private readonly entries = new Map<string, SemanticSearchEntry>();

  add(entry: SemanticSearchEntry): this {
    this.entries.set(entry.id, entry);
    return this;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  get(id: string): SemanticSearchEntry | null {
    return this.entries.get(id) ?? null;
  }

  size(): number {
    return this.entries.size;
  }

  getByOrg(organizationId: number): SemanticSearchEntry[] {
    return Array.from(this.entries.values())
      .filter(e => e.organizationId === organizationId && e.isActive);
  }

  search(
    query:          string,
    organizationId: number,
    topK           = 5,
    minScore       = 0.35,
  ): Array<{ entry: SemanticSearchEntry; result: TokenMatchResult }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const candidates = this.getByOrg(organizationId);

    const scored = candidates
      .map(entry => ({ entry, result: scoreAgainstEntry(queryTokens, entry) }))
      .filter(x => x.result.score >= minScore)
      .sort((a, b) => {
        if (b.result.score !== a.result.score) return b.result.score - a.result.score;
        // Tiebreak: frequência maior primeiro
        if (b.entry.frequency !== a.entry.frequency) return b.entry.frequency - a.entry.frequency;
        return a.entry.id.localeCompare(b.entry.id);
      });

    return scored.slice(0, topK);
  }

  clear(): void {
    this.entries.clear();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSearchEntry(
  organizationId: number,
  canonicalText:  string,
  params: {
    displayText?:   string;
    category?:      string;
    subcategory?:   string;
    aliases?:       string[];
    source?:        SemanticSearchEntry["source"];
    catmatCode?:    string;
    catmatGroup?:   string;
    catmatClass?:   string;
  } = {},
): SemanticSearchEntry {
  const aliases      = params.aliases ?? [];
  const tokens       = tokenize(canonicalText);
  const synonymTokens = [...new Set(aliases.flatMap(a => tokenize(a)))];
  const now          = new Date().toISOString();

  return {
    id:             nanoid(),
    organizationId,
    canonicalText,
    displayText:    params.displayText ?? canonicalText,
    category:       params.category,
    subcategory:    params.subcategory,
    tokens,
    aliases,
    synonymTokens,
    frequency:      0,
    source:         params.source ?? "manual",
    catmatCode:     params.catmatCode,
    catmatGroup:    params.catmatGroup,
    catmatClass:    params.catmatClass,
    createdAt:      now,
    updatedAt:      now,
    isActive:       true,
  };
}

export function incrementFrequency(entry: SemanticSearchEntry): SemanticSearchEntry {
  return {
    ...entry,
    frequency:   entry.frequency + 1,
    lastSeenAt:  new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
}

// ─── Singleton index (org-aware, in-memory) ───────────────────────────────────

export const globalSemanticIndex = new SemanticIndex();
