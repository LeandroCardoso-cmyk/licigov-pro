export interface EvidenceCandidate {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly score: number;
  readonly confidence: number;
  readonly type: string;
}

export function selectEvidence(
  candidates: EvidenceCandidate[],
  _query: string,
  maxEvidence: number = 10
): EvidenceCandidate[] {
  const ranked = rankEvidence(candidates);
  const unique = removeDuplicates(ranked);
  const diverse = diversifyEvidence(unique);
  return diverse.slice(0, maxEvidence);
}

export function rankEvidence(
  candidates: EvidenceCandidate[]
): EvidenceCandidate[] {
  return [...candidates].sort((a, b) => b.score - a.score);
}

function getWordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)
  );
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersectionSize = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  if (unionSize === 0) return 1;
  return intersectionSize / unionSize;
}

export function removeDuplicates(
  evidence: EvidenceCandidate[]
): EvidenceCandidate[] {
  const kept: EvidenceCandidate[] = [];
  const keptWordSets: Set<string>[] = [];

  for (const item of evidence) {
    const words = getWordSet(item.content);
    let isDuplicate = false;

    for (const keptWords of keptWordSets) {
      if (jaccardSimilarity(words, keptWords) > 0.9) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(item);
      keptWordSets.push(words);
    }
  }

  return kept;
}

export function weightByConfidence(
  evidence: EvidenceCandidate[]
): EvidenceCandidate[] {
  return evidence.map((item) => ({
    ...item,
    score: item.score * item.confidence,
  }));
}

export function detectContradictions(
  evidence: EvidenceCandidate[]
): Array<{ a: EvidenceCandidate; b: EvidenceCandidate; reason: string }> {
  const contradictions: Array<{
    a: EvidenceCandidate;
    b: EvidenceCandidate;
    reason: string;
  }> = [];

  for (let i = 0; i < evidence.length; i++) {
    for (let j = i + 1; j < evidence.length; j++) {
      const itemA = evidence[i];
      const itemB = evidence[j];

      const wordsA = itemA.content.toLowerCase().split(/\s+/);
      const wordsB = itemB.content.toLowerCase().split(/\s+/);

      // Check if A has "não" + keyword and B has keyword without "não"
      const negatedKeywordsA = new Set<string>();
      for (let k = 0; k < wordsA.length - 1; k++) {
        if (wordsA[k] === "não") {
          negatedKeywordsA.add(wordsA[k + 1]);
        }
      }

      for (const keyword of negatedKeywordsA) {
        const bHasKeywordWithoutNao = wordsB.some(
          (word, idx) => word === keyword && (idx === 0 || wordsB[idx - 1] !== "não")
        );
        if (bHasKeywordWithoutNao) {
          contradictions.push({
            a: itemA,
            b: itemB,
            reason: `Contradiction on keyword: ${keyword}`,
          });
          break;
        }
      }

      // Also check the reverse: B has "não" + keyword and A has keyword without "não"
      if (!contradictions.some((c) => c.a === itemA && c.b === itemB)) {
        const negatedKeywordsB = new Set<string>();
        for (let k = 0; k < wordsB.length - 1; k++) {
          if (wordsB[k] === "não") {
            negatedKeywordsB.add(wordsB[k + 1]);
          }
        }

        for (const keyword of negatedKeywordsB) {
          const aHasKeywordWithoutNao = wordsA.some(
            (word, idx) => word === keyword && (idx === 0 || wordsA[idx - 1] !== "não")
          );
          if (aHasKeywordWithoutNao) {
            contradictions.push({
              a: itemA,
              b: itemB,
              reason: `Contradiction on keyword: ${keyword}`,
            });
            break;
          }
        }
      }
    }
  }

  return contradictions;
}

export function diversifyEvidence(
  evidence: EvidenceCandidate[],
  maxPerSource: number = 3
): EvidenceCandidate[] {
  const sourceCounts = new Map<string, number>();
  const result: EvidenceCandidate[] = [];

  for (const item of evidence) {
    const count = sourceCounts.get(item.source) ?? 0;
    if (count < maxPerSource) {
      result.push(item);
      sourceCounts.set(item.source, count + 1);
    }
  }

  return result;
}
