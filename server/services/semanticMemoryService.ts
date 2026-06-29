import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export interface SemanticMemoryLink {
  readonly id: string;
  readonly organizationId: number;
  readonly sourceChunkId: string;
  readonly targetChunkId: string;
  readonly linkType: "correlation" | "reuse" | "precedent" | "contradiction" | "evolution";
  readonly strength: number;
  readonly context: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

const _memoryLinks = new Map<number, SemanticMemoryLink[]>();

export function createMemoryLink(params: {
  organizationId: number;
  sourceChunkId: string;
  targetChunkId: string;
  linkType: SemanticMemoryLink["linkType"];
  strength?: number;
  context?: string;
  correlationId: string;
}): SemanticMemoryLink {
  const now = new Date().toISOString();
  const id = sha256(`sml:${params.organizationId}:${params.sourceChunkId}:${params.targetChunkId}:${params.linkType}`).slice(0, 20);
  const link: SemanticMemoryLink = {
    id, organizationId: params.organizationId,
    sourceChunkId: params.sourceChunkId, targetChunkId: params.targetChunkId,
    linkType: params.linkType, strength: params.strength ?? 0.5,
    context: params.context ?? "", correlationId: params.correlationId, createdAt: now,
  };
  const existing = _memoryLinks.get(params.organizationId) ?? [];
  _memoryLinks.set(params.organizationId, [...existing, link]);
  return link;
}

export function getMemoryLinks(organizationId: number, chunkId?: string): SemanticMemoryLink[] {
  const all = _memoryLinks.get(organizationId) ?? [];
  if (!chunkId) return all;
  return all.filter(l => l.sourceChunkId === chunkId || l.targetChunkId === chunkId);
}

export function findCorrelations(organizationId: number, chunkId: string): SemanticMemoryLink[] {
  return getMemoryLinks(organizationId, chunkId).filter(l => l.linkType === "correlation");
}

export function findPrecedents(organizationId: number, chunkId: string): SemanticMemoryLink[] {
  return getMemoryLinks(organizationId, chunkId).filter(l => l.linkType === "precedent");
}

export function getMemoryStats(organizationId: number): { totalLinks: number; byType: Record<string, number>; avgStrength: number } {
  const all = _memoryLinks.get(organizationId) ?? [];
  const byType: Record<string, number> = {};
  for (const l of all) byType[l.linkType] = (byType[l.linkType] ?? 0) + 1;
  const avgStrength = all.length > 0 ? all.reduce((s, l) => s + l.strength, 0) / all.length : 0;
  return { totalLinks: all.length, byType, avgStrength };
}

export function deleteMemoryLink(organizationId: number, linkId: string): boolean {
  const existing = _memoryLinks.get(organizationId) ?? [];
  const filtered = existing.filter(l => l.id !== linkId);
  _memoryLinks.set(organizationId, filtered);
  return filtered.length < existing.length;
}
