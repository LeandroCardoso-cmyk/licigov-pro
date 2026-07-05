import { createHash } from "crypto";

export interface ExtractedEntity {
  readonly type: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly position: number;
  readonly confidence: number;
  readonly organizationId: number;
}

const LEGISLATION_PATTERN = /\b(lei|decreto|portaria|resolução)\s+n?º?\s*[\d.]+\/?\d*/gi;
const ITEM_PATTERN = /\bcatmat\s*\d+|catser\s*\d+/gi;
const MONETARY_PATTERN = /\bR\$\s*[\d.,]+/g;
const DATE_PATTERN = /\b\d{2}\/\d{2}\/\d{4}/g;

export function extractEntities(text: string, orgId: number): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  let match: RegExpExecArray | null;

  const legislationRegex = new RegExp(LEGISLATION_PATTERN.source, "gi");
  while ((match = legislationRegex.exec(text)) !== null) {
    entities.push({
      type: "legislation",
      value: match[0],
      normalizedValue: match[0].toLowerCase().replace(/\s+/g, " ").trim(),
      position: match.index,
      confidence: 0.9,
      organizationId: orgId,
    });
  }

  const itemRegex = new RegExp(ITEM_PATTERN.source, "gi");
  while ((match = itemRegex.exec(text)) !== null) {
    entities.push({
      type: "item",
      value: match[0],
      normalizedValue: match[0].toLowerCase().replace(/\s+/g, " ").trim(),
      position: match.index,
      confidence: 0.95,
      organizationId: orgId,
    });
  }

  const monetaryRegex = new RegExp(MONETARY_PATTERN.source, "g");
  while ((match = monetaryRegex.exec(text)) !== null) {
    entities.push({
      type: "monetary",
      value: match[0],
      normalizedValue: match[0].replace(/\s+/g, "").trim(),
      position: match.index,
      confidence: 0.85,
      organizationId: orgId,
    });
  }

  const dateRegex = new RegExp(DATE_PATTERN.source, "g");
  while ((match = dateRegex.exec(text)) !== null) {
    entities.push({
      type: "date",
      value: match[0],
      normalizedValue: match[0].trim(),
      position: match.index,
      confidence: 0.8,
      organizationId: orgId,
    });
  }

  return entities;
}

export function normalizeEntity(entity: ExtractedEntity): ExtractedEntity {
  return {
    ...entity,
    value: entity.value.trim(),
    normalizedValue: entity.value.toLowerCase().replace(/\s+/g, " ").trim(),
  };
}

export function deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Set<string>();
  const result: ExtractedEntity[] = [];
  for (const entity of entities) {
    const key = `${entity.type}:${entity.normalizedValue}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entity);
    }
  }
  return result;
}

export function classifyEntity(text: string): string {
  const lower = text.toLowerCase().trim();
  if (/\b(lei|decreto|portaria|resolução|instrução normativa)\b/.test(lower)) {
    return "legislation";
  }
  if (/\b(catmat|catser)\b/.test(lower)) {
    return "item";
  }
  if (/\br\$/.test(lower) || /\b(valor|preço|custo)\b/.test(lower)) {
    return "monetary";
  }
  if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(lower)) {
    return "date";
  }
  if (/\b(prefeitura|secretaria|ministério|autarquia|fundação|empresa pública)\b/.test(lower)) {
    return "organization";
  }
  return "concept";
}
