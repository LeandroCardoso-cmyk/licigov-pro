import { createHash } from "crypto";

export type NodeType =
  | "legislation"
  | "article"
  | "clause"
  | "jurisprudence"
  | "parecer"
  | "catmat_item"
  | "catser_item"
  | "tr_item"
  | "supplier"
  | "public_body"
  | "municipality"
  | "process"
  | "contract"
  | "ata"
  | "risk"
  | "technical_requirement"
  | "document"
  | "concept";

export interface KnowledgeNode {
  readonly id: string;
  readonly organizationId: number;
  readonly nodeType: NodeType;
  readonly externalId: string | null;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly metadata: Record<string, unknown>;
  readonly confidence: number;
  readonly source: string;
  readonly version: number;
  readonly active: boolean;
  readonly createdAt: string;
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

export function createKnowledgeNode(params: {
  organizationId: number;
  nodeType: NodeType;
  title: string;
  description?: string;
  externalId?: string | null;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  confidence?: number;
  source?: string;
}): KnowledgeNode {
  const normalizedTitle = normalizeTitle(params.title);
  const id = createHash("sha256")
    .update(`kn:${params.organizationId}:${params.nodeType}:${normalizedTitle}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    nodeType: params.nodeType,
    externalId: params.externalId ?? null,
    title: params.title,
    normalizedTitle,
    description: params.description ?? "",
    aliases: params.aliases ?? [],
    metadata: params.metadata ?? {},
    confidence: params.confidence ?? 1.0,
    source: params.source ?? "manual",
    version: 1,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

export function matchesAlias(node: KnowledgeNode, query: string): boolean {
  const normalized = normalizeTitle(query);
  if (node.normalizedTitle.includes(normalized)) return true;
  return node.aliases.some(a => normalizeTitle(a).includes(normalized));
}

export function updateNodeVersion(node: KnowledgeNode, changes: Partial<Pick<KnowledgeNode, "title" | "description" | "aliases" | "metadata" | "confidence">>): KnowledgeNode {
  return {
    ...node,
    ...changes,
    normalizedTitle: changes.title ? normalizeTitle(changes.title) : node.normalizedTitle,
    version: node.version + 1,
  };
}

export function deactivateNode(node: KnowledgeNode): KnowledgeNode {
  return { ...node, active: false };
}
