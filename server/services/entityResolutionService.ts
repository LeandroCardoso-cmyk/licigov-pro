import { createHash } from "crypto";

export interface ResolutionResult {
  readonly matchedId: string | null;
  readonly confidence: number;
  readonly strategy: "exact" | "fuzzy" | "alias" | "none";
}

export function resolveEntity(
  candidates: Array<{ id: string; title: string; aliases: string[] }>,
  query: string,
  orgId: number
): ResolutionResult {
  const normalizedQuery = query.toLowerCase().trim();

  // Exact match on title
  for (const candidate of candidates) {
    if (candidate.title.toLowerCase().trim() === normalizedQuery) {
      return { matchedId: candidate.id, confidence: 1.0, strategy: "exact" };
    }
  }

  // Alias match
  for (const candidate of candidates) {
    for (const alias of candidate.aliases) {
      if (alias.toLowerCase().trim() === normalizedQuery) {
        return { matchedId: candidate.id, confidence: 0.95, strategy: "alias" };
      }
    }
  }

  // Fuzzy match using Dice coefficient
  let bestMatch: { id: string; similarity: number } | null = null;
  for (const candidate of candidates) {
    const similarity = computeStringSimilarity(normalizedQuery, candidate.title.toLowerCase().trim());
    if (similarity > 0.6 && (!bestMatch || similarity > bestMatch.similarity)) {
      bestMatch = { id: candidate.id, similarity };
    }
    for (const alias of candidate.aliases) {
      const aliasSim = computeStringSimilarity(normalizedQuery, alias.toLowerCase().trim());
      if (aliasSim > 0.6 && (!bestMatch || aliasSim > bestMatch.similarity)) {
        bestMatch = { id: candidate.id, similarity: aliasSim };
      }
    }
  }

  if (bestMatch) {
    return { matchedId: bestMatch.id, confidence: bestMatch.similarity, strategy: "fuzzy" };
  }

  return { matchedId: null, confidence: 0, strategy: "none" };
}

export function computeStringSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 0));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 0));

  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  return (2 * intersection) / (wordsA.size + wordsB.size);
}

export function findDuplicates(
  entities: Array<{ id: string; title: string; organizationId: number }>
): Array<{ entityA: string; entityB: string; similarity: number }> {
  const duplicates: Array<{ entityA: string; entityB: string; similarity: number }> = [];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (entities[i].organizationId !== entities[j].organizationId) continue;
      const similarity = computeStringSimilarity(entities[i].title, entities[j].title);
      if (similarity > 0.8) {
        duplicates.push({
          entityA: entities[i].id,
          entityB: entities[j].id,
          similarity,
        });
      }
    }
  }

  return duplicates;
}

export function mergeEntities(
  primary: { id: string; title: string; aliases: string[] },
  secondary: { id: string; title: string; aliases: string[] }
): { id: string; title: string; aliases: string[] } {
  const mergedAliases = new Set([...primary.aliases, ...secondary.aliases, secondary.title]);
  mergedAliases.delete(primary.title);

  return {
    id: primary.id,
    title: primary.title,
    aliases: Array.from(mergedAliases),
  };
}
