/**
 * RC-4.7 — Institutional Knowledge Framework · Knowledge Document (Part 1).
 *
 * Modelo GENÉRICO de documento institucional de conhecimento. Sem acoplamento com Lei 14.133 ou
 * qualquer conteúdo — os corpora futuros são apenas CONSUMIDORES. Multi-tenant, determinístico
 * (id/lineage/replayHash via sha256), versionado. Reutilizável por qualquer domínio.
 */

import { createHash } from "crypto";
import type { KnowledgeBlock } from "./knowledgeBlocks";
import { blockFingerprint } from "./knowledgeBlocks";
import type { KnowledgeLifecycleState } from "./knowledgeLifecycle";

export interface KnowledgeMetadata { readonly [key: string]: unknown; }

export interface KnowledgeSection {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly blocks: readonly KnowledgeBlock[];
  readonly metadata: KnowledgeMetadata;
}

export type KnowledgeReferenceType = "cites" | "supersedes" | "relates_to" | "derived_from" | "regulated_by";
export interface KnowledgeReference {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly type: KnowledgeReferenceType;
  readonly explanation: string;
}

export type KnowledgeRelationshipType = "parent" | "child" | "sibling" | "depends_on" | "supplements";
export interface KnowledgeRelationship {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: KnowledgeRelationshipType;
  readonly strength: number;
  readonly explanation: string;
}

export interface KnowledgeDocument {
  readonly id: string;
  readonly tenantId: number;
  /** Chave estável do documento (identidade lógica entre versões). */
  readonly docKey: string;
  readonly title: string;
  readonly sections: readonly KnowledgeSection[];
  readonly references: readonly KnowledgeReference[];
  readonly relationships: readonly KnowledgeRelationship[];
  /** Versão semântica (Part 6). */
  readonly semver: string;
  /** Revisão monotônica (ordenação determinística de versões). */
  readonly revision: number;
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly lineageId: string;
  readonly metadata: KnowledgeMetadata;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Hash determinístico da estrutura (replay-safe; sem createdAt/updatedAt). */
  readonly replayHash: string;
}

export function computeDocumentLineage(params: { tenantId: number; docKey: string }): string {
  return createHash("sha256").update(`kdlin:${params.tenantId}:${params.docKey}`).digest("hex").slice(0, 20);
}

function sectionFingerprint(s: KnowledgeSection): string {
  return createHash("sha256").update(JSON.stringify({
    title: s.title, order: s.order, blocks: [...s.blocks].sort((a, b) => a.order - b.order).map(blockFingerprint),
  })).digest("hex").slice(0, 16);
}

function computeReplayHash(d: Omit<KnowledgeDocument, "id" | "createdAt" | "updatedAt" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: d.tenantId, docKey: d.docKey, title: d.title,
    sections: [...d.sections].sort((a, b) => a.order - b.order).map(sectionFingerprint),
    references: [...d.references].map(r => `${r.type}:${r.from}:${r.to}`).sort(),
    relationships: [...d.relationships].map(r => `${r.type}:${r.source}:${r.target}`).sort(),
    semver: d.semver, revision: d.revision, lifecycle: d.lifecycleState, lineage: d.lineageId, metadata: d.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateKnowledgeDocumentParams {
  tenantId: number;
  docKey: string;
  title: string;
  sections?: KnowledgeSection[];
  references?: KnowledgeReference[];
  relationships?: KnowledgeRelationship[];
  semver?: string;
  revision?: number;
  lifecycleState?: KnowledgeLifecycleState;
  metadata?: KnowledgeMetadata;
  createdAt?: string;
  updatedAt?: string;
}

/** Cria (ou versiona) um documento de conhecimento. Determinístico; nunca sobrescreve. */
export function createKnowledgeDocument(params: CreateKnowledgeDocumentParams): KnowledgeDocument {
  const revision = params.revision ?? 1;
  const lineageId = computeDocumentLineage({ tenantId: params.tenantId, docKey: params.docKey });
  const base: Omit<KnowledgeDocument, "id" | "createdAt" | "updatedAt" | "replayHash"> = {
    tenantId: params.tenantId, docKey: params.docKey, title: params.title,
    sections: params.sections ?? [], references: params.references ?? [], relationships: params.relationships ?? [],
    semver: params.semver ?? "1.0.0", revision, lifecycleState: params.lifecycleState ?? "draft",
    lineageId, metadata: params.metadata ?? {},
  };
  const replayHash = computeReplayHash(base);
  const id = createHash("sha256").update(`kdoc:${params.tenantId}:${lineageId}:${revision}`).digest("hex").slice(0, 20);
  const createdAt = params.createdAt ?? new Date().toISOString();
  return { id, ...base, createdAt, updatedAt: params.updatedAt ?? createdAt, replayHash };
}

export function createSection(params: { docKey: string; title: string; order?: number; blocks?: KnowledgeBlock[]; metadata?: KnowledgeMetadata }): KnowledgeSection {
  const order = params.order ?? 0;
  const id = createHash("sha256").update(`ksec:${params.docKey}:${params.title}:${order}`).digest("hex").slice(0, 20);
  return { id, title: params.title, order, blocks: params.blocks ?? [], metadata: params.metadata ?? {} };
}

export function createReference(p: { from: string; to: string; type: KnowledgeReferenceType; explanation: string }): KnowledgeReference {
  const id = createHash("sha256").update(`kref:${p.type}:${p.from}:${p.to}`).digest("hex").slice(0, 20);
  return { id, from: p.from, to: p.to, type: p.type, explanation: p.explanation };
}

export function createRelationship(p: { source: string; target: string; type: KnowledgeRelationshipType; strength?: number; explanation: string }): KnowledgeRelationship {
  const id = createHash("sha256").update(`krel:${p.type}:${p.source}:${p.target}`).digest("hex").slice(0, 20);
  return { id, source: p.source, target: p.target, type: p.type, strength: p.strength ?? 0.8, explanation: p.explanation };
}

/** Todos os blocos do documento (achatados, em ordem determinística). */
export function allBlocks(doc: KnowledgeDocument): KnowledgeBlock[] {
  return [...doc.sections].sort((a, b) => a.order - b.order).flatMap(s => [...s.blocks].sort((a, b) => a.order - b.order));
}

export function isValidDocument(doc: KnowledgeDocument): boolean {
  return doc.tenantId > 0 && doc.docKey.length > 0 && doc.title.length > 0 && doc.revision >= 1;
}
