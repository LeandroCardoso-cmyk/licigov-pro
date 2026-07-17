/**
 * RC-4.5.1 — Institutional Corpus Framework · KnowledgeCollection (Part 3).
 *
 * Uma coleção pertence EXATAMENTE a um Corpus (nunca diretamente ao sistema). Agrupa membros
 * de conhecimento (LegalKnowledgeUnit, documentos, conceitos, normas, referências e fontes
 * futuras) apenas por REFERÊNCIA — não contém conteúdo. Multi-tenant, determinística,
 * append-only nos membros. Nenhum conhecimento jurídico é inserido aqui.
 */

import { createHash } from "crypto";

/** Tipos de membro que uma coleção pode agrupar (por referência). Expansível. */
export type CollectionMemberKind =
  | "legal_unit" | "document" | "concept" | "norm" | "reference" | "source";

export interface CollectionMember {
  readonly kind: CollectionMemberKind;
  /** Identificador do item referenciado (ex.: id de LegalKnowledgeUnit). Nunca conteúdo. */
  readonly refId: string;
  readonly note: string;
}

export interface KnowledgeCollection {
  readonly id: string;
  readonly tenantId: number;
  /** Corpus ao qual a coleção pertence (obrigatório — nunca solta no sistema). */
  readonly corpusId: string;
  readonly name: string;
  readonly description: string;
  readonly members: readonly CollectionMember[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly replayHash: string;
}

function computeReplayHash(c: Omit<KnowledgeCollection, "id" | "createdAt" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: c.tenantId, corpus: c.corpusId, name: c.name, description: c.description,
    members: [...c.members].map(m => `${m.kind}:${m.refId}`).sort(), metadata: c.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateKnowledgeCollectionParams {
  tenantId: number;
  corpusId: string;
  name: string;
  description?: string;
  members?: CollectionMember[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

/** Cria uma coleção vinculada a um Corpus. Determinística. */
export function createKnowledgeCollection(params: CreateKnowledgeCollectionParams): KnowledgeCollection {
  const base = {
    tenantId: params.tenantId, corpusId: params.corpusId, name: params.name,
    description: params.description ?? "", members: params.members ?? [], metadata: params.metadata ?? {},
  };
  const replayHash = computeReplayHash(base);
  const id = createHash("sha256").update(`kcol:${params.tenantId}:${params.corpusId}:${params.name}`).digest("hex").slice(0, 20);
  return { id, ...base, createdAt: params.createdAt ?? new Date().toISOString(), replayHash };
}

/**
 * Adiciona um membro à coleção (append-only — retorna nova coleção; nunca sobrescreve).
 * Idempotente por (kind, refId): membro duplicado não é adicionado.
 */
export function addMember(collection: KnowledgeCollection, member: CollectionMember, createdAt?: string): KnowledgeCollection {
  if (collection.members.some(m => m.kind === member.kind && m.refId === member.refId)) return collection;
  return createKnowledgeCollection({
    tenantId: collection.tenantId, corpusId: collection.corpusId, name: collection.name,
    description: collection.description, members: [...collection.members, member], metadata: collection.metadata,
    createdAt: createdAt ?? collection.createdAt,
  });
}

/** Remove um membro (retorna nova coleção). */
export function removeMember(collection: KnowledgeCollection, kind: CollectionMemberKind, refId: string, createdAt?: string): KnowledgeCollection {
  return createKnowledgeCollection({
    tenantId: collection.tenantId, corpusId: collection.corpusId, name: collection.name,
    description: collection.description, members: collection.members.filter(m => !(m.kind === kind && m.refId === refId)),
    metadata: collection.metadata, createdAt: createdAt ?? collection.createdAt,
  });
}

export function isValidCollection(c: KnowledgeCollection): boolean {
  return c.tenantId > 0 && c.corpusId.length > 0 && c.name.length > 0;
}
