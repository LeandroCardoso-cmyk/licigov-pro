import { createHash } from "crypto";

export interface OntologyConcept {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly parentId: string | null;
  readonly aliases: string[];
  readonly organizationId: number;
}

export interface OntologyNode {
  readonly concept: OntologyConcept;
  readonly children: OntologyNode[];
}

export function buildOntologyTree(concepts: OntologyConcept[]): OntologyNode[] {
  const nodeMap = new Map<string, OntologyNode>();
  const roots: OntologyNode[] = [];

  // Create all nodes first (mutable during construction)
  for (const concept of concepts) {
    nodeMap.set(concept.id, { concept, children: [] });
  }

  // Build parent-child relationships
  for (const concept of concepts) {
    const node = nodeMap.get(concept.id)!;
    if (concept.parentId && nodeMap.has(concept.parentId)) {
      const parent = nodeMap.get(concept.parentId)!;
      (parent.children as OntologyNode[]).push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function classifyDocument(
  text: string,
  concepts: OntologyConcept[]
): Array<{ conceptId: string; confidence: number }> {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const wordSet = new Set(words);
  const results: Array<{ conceptId: string; confidence: number }> = [];

  for (const concept of concepts) {
    let matchCount = 0;
    const conceptWords = concept.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const allTerms = [...conceptWords];

    for (const alias of concept.aliases) {
      const aliasWords = alias.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      allTerms.push(...aliasWords);
    }

    const uniqueTerms = [...new Set(allTerms)];
    for (const term of uniqueTerms) {
      if (wordSet.has(term)) matchCount++;
    }

    if (uniqueTerms.length > 0 && matchCount > 0) {
      const confidence = Math.min(matchCount / uniqueTerms.length, 1.0);
      results.push({ conceptId: concept.id, confidence });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export function findAncestors(conceptId: string, concepts: OntologyConcept[]): OntologyConcept[] {
  const conceptMap = new Map<string, OntologyConcept>();
  for (const c of concepts) {
    conceptMap.set(c.id, c);
  }

  const ancestors: OntologyConcept[] = [];
  let current = conceptMap.get(conceptId);

  while (current && current.parentId) {
    const parent = conceptMap.get(current.parentId);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }

  return ancestors;
}

export function findDescendants(conceptId: string, concepts: OntologyConcept[]): OntologyConcept[] {
  const childrenMap = new Map<string, OntologyConcept[]>();
  for (const c of concepts) {
    if (c.parentId) {
      const existing = childrenMap.get(c.parentId) ?? [];
      existing.push(c);
      childrenMap.set(c.parentId, existing);
    }
  }

  const descendants: OntologyConcept[] = [];
  const queue: string[] = [conceptId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

export function resolveAlias(alias: string, concepts: OntologyConcept[]): OntologyConcept | null {
  const normalizedAlias = alias.toLowerCase().trim();

  for (const concept of concepts) {
    if (concept.name.toLowerCase().trim() === normalizedAlias) {
      return concept;
    }
    for (const a of concept.aliases) {
      if (a.toLowerCase().trim() === normalizedAlias) {
        return concept;
      }
    }
  }

  return null;
}

export function exportOntology(concepts: OntologyConcept[]): string {
  return JSON.stringify(concepts, null, 2);
}
