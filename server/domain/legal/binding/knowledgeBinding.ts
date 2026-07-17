/**
 * RC-4.6.2 — Knowledge Binding Framework · Binding Model (Parts 2, 3, 4).
 *
 * Liga um NormativeNode (RC-4.6.1) a uma LegalKnowledgeUnit (RC-4.5) — SEM inserir conteúdo
 * jurídico. Binding é append-only, imutável, versionado, replay-safe e auditável. Multi-tenant,
 * determinístico (id/lineage/replayHash via sha256). Reutilizável para qualquer norma.
 */

import { createHash } from "crypto";

/** Tipos de vínculo (Part 3). */
export type BindingType =
  | "PRIMARY" | "SECONDARY" | "SUPPLEMENTAL" | "INTERPRETATIVE" | "REFERENCE" | "REGULATORY";

export const ALL_BINDING_TYPES: BindingType[] = [
  "PRIMARY", "SECONDARY", "SUPPLEMENTAL", "INTERPRETATIVE", "REFERENCE", "REGULATORY",
];

export function isBindingType(t: string): t is BindingType {
  return (ALL_BINDING_TYPES as readonly string[]).includes(t);
}

/** Ciclo de vida do binding (append-only — nova versão nunca sobrescreve). */
export type BindingStatus = "active" | "superseded" | "revoked";

export interface KnowledgeBindingMetadata {
  readonly [key: string]: unknown;
}

export interface KnowledgeBinding {
  readonly bindingId: string;
  readonly tenantId: number;
  /** Nó normativo (ex.: um artigo da Lei 14.133). */
  readonly normativeNodeId: string;
  /** Unidade de conhecimento jurídico (referência — nunca conteúdo). */
  readonly knowledgeUnitId: string;
  readonly bindingType: BindingType;
  readonly authority: string;
  readonly scope: string;
  readonly version: number;
  readonly status: BindingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Linhagem estável (mesmo nó+unidade+tipo → mesma linhagem; versões acumulam). */
  readonly lineageId: string;
  readonly metadata: KnowledgeBindingMetadata;
  /** Hash determinístico dos campos estruturais (replay-safe; sem createdAt/updatedAt). */
  readonly replayHash: string;
}

/** Linhagem estável de um binding (independente da versão/status). */
export function computeBindingLineage(params: {
  tenantId: number; normativeNodeId: string; knowledgeUnitId: string; bindingType: BindingType;
}): string {
  return createHash("sha256")
    .update(`blin:${params.tenantId}:${params.normativeNodeId}:${params.knowledgeUnitId}:${params.bindingType}`)
    .digest("hex").slice(0, 20);
}

function computeReplayHash(b: Omit<KnowledgeBinding, "bindingId" | "createdAt" | "updatedAt" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: b.tenantId, node: b.normativeNodeId, unit: b.knowledgeUnitId, type: b.bindingType,
    authority: b.authority, scope: b.scope, version: b.version, status: b.status,
    lineage: b.lineageId, metadata: b.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateKnowledgeBindingParams {
  tenantId: number;
  normativeNodeId: string;
  knowledgeUnitId: string;
  bindingType: BindingType;
  authority?: string;
  scope?: string;
  version?: number;
  status?: BindingStatus;
  metadata?: KnowledgeBindingMetadata;
  createdAt?: string;
  updatedAt?: string;
}

/** Cria (ou versiona) um binding. Determinístico; nunca sobrescreve (append-only). */
export function createKnowledgeBinding(params: CreateKnowledgeBindingParams): KnowledgeBinding {
  const version = params.version ?? 1;
  const lineageId = computeBindingLineage({
    tenantId: params.tenantId, normativeNodeId: params.normativeNodeId,
    knowledgeUnitId: params.knowledgeUnitId, bindingType: params.bindingType,
  });
  const base = {
    tenantId: params.tenantId, normativeNodeId: params.normativeNodeId, knowledgeUnitId: params.knowledgeUnitId,
    bindingType: params.bindingType, authority: params.authority ?? "Congresso Nacional", scope: params.scope ?? "federal",
    version, status: params.status ?? "active" as BindingStatus, lineageId, metadata: params.metadata ?? {},
  };
  const replayHash = computeReplayHash(base);
  const bindingId = createHash("sha256").update(`kbind:${params.tenantId}:${lineageId}:${version}`).digest("hex").slice(0, 20);
  const createdAt = params.createdAt ?? new Date().toISOString();
  return { bindingId, ...base, createdAt, updatedAt: params.updatedAt ?? createdAt, replayHash };
}

export function isValidBinding(b: KnowledgeBinding): boolean {
  return isBindingType(b.bindingType) && b.tenantId > 0 && b.normativeNodeId.length > 0
    && b.knowledgeUnitId.length > 0 && b.version >= 1;
}
