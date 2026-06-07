import { createHash } from "crypto";

export interface SearchQuery {
  id: string;
  organizationId: number;
  rawQuery: string;
  expandedTerms: string[];
  synonymExpansion: string[];
  correctedQuery: string;
  filters: Record<string, unknown>;
  replayKey: string;
  createdAt: string;
}

export interface SearchHit {
  id: string;
  content: string;
  documentId: string;
  lexicalScore: number;
  semanticScore: number;
  finalScore: number;
  matchedTerms: string[];
  explanation: string;
  rank: number;
}

export interface SearchResponse {
  queryId: string;
  organizationId: number;
  hits: SearchHit[];
  totalHits: number;
  expandedQuery: SearchQuery;
  durationMs: number;
  replayKey: string;
}

export const LEGAL_SYNONYMS: Record<string, string[]> = {
  licitação: ["pregão", "concorrência", "tomada de preços", "convite", "leilão", "RDC"],
  dispensa: ["compra direta", "contratação direta", "inexigibilidade"],
  tr: ["termo de referência", "projeto básico", "ETP"],
  catmat: ["catálogo de material", "código catmat", "item catmat"],
  pregoeiro: ["agente de contratação", "comissão de licitação"],
  contrato: ["instrumento contratual", "ajuste", "avença", "acordo"],
  fiscal: ["gestor de contrato", "fiscalização", "executor"],
  parecer: ["manifestação jurídica", "nota técnica", "despacho"],
  edital: ["instrumento convocatório", "convocação", "chamamento"],
  fornecedor: ["licitante", "proponente", "contratado", "empresa"],
  empenho: ["nota de empenho", "NE", "compromisso orçamentário"],
  pregão: ["pregão eletrônico", "pregão presencial", "PE"],
  ata: ["ata de registro de preços", "ARP", "sistema de registro de preços"],
  subcontratação: ["terceirização", "execução indireta"],
  penalidade: ["sanção", "multa contratual", "suspensão", "impedimento"],
};

export const TYPO_CORRECTIONS: Record<string, string> = {
  "licitaçao": "licitação",
  "refernecia": "referência",
  "cotrato": "contrato",
  "pregao": "pregão",
  "fornecedro": "fornecedor",
  "emepnho": "empenho",
  "fiscalizaçao": "fiscalização",
  "parcer": "parecer",
  "edtial": "edital",
  "concorencia": "concorrência",
  "inesigibilidade": "inexigibilidade",
  "catamt": "catmat",
  "ataa": "ata",
};

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2);
}

function applyTypoCorrections(text: string): string {
  let result = text;
  for (const [typo, correction] of Object.entries(TYPO_CORRECTIONS)) {
    const re = new RegExp(`\\b${typo}\\b`, "gi");
    result = result.replace(re, correction);
  }
  return result;
}

function findSynonyms(tokens: string[]): string[] {
  const synonyms: string[] = [];
  for (const token of tokens) {
    const found = LEGAL_SYNONYMS[token];
    if (found) {
      synonyms.push(...found);
    } else {
      for (const [key, values] of Object.entries(LEGAL_SYNONYMS)) {
        if (values.includes(token) && !synonyms.includes(key)) {
          synonyms.push(key);
        }
      }
    }
  }
  return Array.from(new Set(synonyms));
}

function computeSemanticScoreMock(queryId: string, itemId: string): number {
  const hash = createHash("sha256").update(`${queryId}|${itemId}`).digest("hex");
  return (parseInt(hash.slice(0, 8), 16) % 1000) / 1000;
}

export function expandQuery(rawQuery: string, organizationId: number): SearchQuery {
  const now = new Date().toISOString();
  const normalized = rawQuery.toLowerCase().trim();
  const correctedQuery = applyTypoCorrections(normalized);
  const expandedTerms = Array.from(new Set(tokenizeText(correctedQuery)));
  const synonymExpansion = findSynonyms(expandedTerms);
  const replayKey = sha20(rawQuery + organizationId);
  const id = sha20(`${organizationId}${replayKey}`);

  return {
    id,
    organizationId,
    rawQuery,
    expandedTerms,
    synonymExpansion,
    correctedQuery,
    filters: {},
    replayKey,
    createdAt: now,
  };
}

export function search(
  query: SearchQuery,
  corpus: Array<{ id: string; content: string; documentId: string; metadata: Record<string, unknown> }>
): SearchResponse {
  const start = Date.now();
  const now = new Date().toISOString();
  const allQueryTokens = [...query.expandedTerms, ...query.synonymExpansion];

  const scored = corpus.map((item) => {
    const contentTokens = new Set(tokenizeText(item.content));
    const matchedTerms = allQueryTokens.filter((t) => contentTokens.has(t));
    const lexicalScore =
      query.expandedTerms.length === 0
        ? 0
        : matchedTerms.filter((t) => query.expandedTerms.includes(t)).length /
          query.expandedTerms.length;

    const semanticScore = computeSemanticScoreMock(query.id, item.id);

    const hasSynonymMatch = matchedTerms.some((t) => query.synonymExpansion.includes(t));
    const synonymBoost = hasSynonymMatch ? 1.1 : 1.0;

    const rawFinal = (lexicalScore * 0.6 + semanticScore * 0.4) * synonymBoost;
    const finalScore = Math.min(1.0, rawFinal);

    return { item, lexicalScore, semanticScore, finalScore, matchedTerms };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  const hits: SearchHit[] = scored
    .filter((s) => s.finalScore > 0)
    .map((s, idx) => ({
      id: sha20(`${query.id}${s.item.id}${idx}`),
      content: s.item.content,
      documentId: s.item.documentId,
      lexicalScore: s.lexicalScore,
      semanticScore: s.semanticScore,
      finalScore: s.finalScore,
      matchedTerms: s.matchedTerms,
      explanation:
        `lexical=${s.lexicalScore.toFixed(3)}, semantic=${s.semanticScore.toFixed(3)}, ` +
        `final=${s.finalScore.toFixed(3)}, termos: [${s.matchedTerms.slice(0, 5).join(", ")}]`,
      rank: idx + 1,
    }));

  const responseReplayKey = sha20(
    query.replayKey + corpus.map((c) => c.id).sort().join("")
  );

  return {
    queryId: query.id,
    organizationId: query.organizationId,
    hits,
    totalHits: hits.length,
    expandedQuery: query,
    durationMs: Date.now() - start,
    replayKey: responseReplayKey,
  };
}

export function applySemanticBoost(hits: SearchHit[], boostFactor = 1.2): SearchHit[] {
  return hits.map((hit) => {
    if (hit.semanticScore > 0.7) {
      return { ...hit, finalScore: Math.min(1.0, hit.finalScore * boostFactor) };
    }
    return hit;
  });
}

export function applyContextualBoost(
  hits: SearchHit[],
  context: Record<string, unknown>
): SearchHit[] {
  const contextTokens = new Set(
    Object.values(context)
      .filter((v): v is string => typeof v === "string")
      .flatMap((v) => tokenizeText(v))
  );

  return hits.map((hit) => {
    const overlap = hit.matchedTerms.filter((t) => contextTokens.has(t)).length;
    if (overlap > 0) {
      const boost = 1.0 + overlap * 0.05;
      return { ...hit, finalScore: Math.min(1.0, hit.finalScore * boost) };
    }
    return hit;
  });
}

export function suggestQueryExpansion(query: string): string[] {
  const tokens = tokenizeText(query.toLowerCase());
  const usedSynonyms = new Set(findSynonyms(tokens));
  const allSynonyms: string[] = [];

  for (const token of tokens) {
    const found = LEGAL_SYNONYMS[token] ?? [];
    allSynonyms.push(...found);
  }

  return Array.from(new Set(allSynonyms)).filter((s) => !usedSynonyms.has(s));
}
