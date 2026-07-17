/**
 * RC-4.6.1 — Federal Procurement Corpus · Normative Node (Parts 1, 3, 4).
 *
 * Nó estrutural de um ato normativo (reutilizável para QUALQUER norma). Contém apenas ESTRUTURA —
 * NUNCA texto jurídico. Multi-tenant, determinístico (id/lineage/replayHash via sha256).
 * A ligação com conhecimento (LegalKnowledgeUnit) é preparada mas nula nesta RC (Part 4).
 */

import { createHash } from "crypto";
import { isNormativeLevel, type NormativeLevelId } from "./normativeHierarchy";

/** Metadados estruturais do nó (Part 1) — nunca conteúdo jurídico. */
export interface NormativeMetadata {
  readonly [key: string]: unknown;
}

export interface NormativeNode {
  readonly id: string;
  readonly tenantId: number;
  /** Ato normativo ao qual o nó pertence (ex.: "lei-14133-2021"). */
  readonly normId: string;
  readonly type: NormativeLevelId;
  /** Identificador estrutural (ex.: "Art. 1º", "Título I") — rótulo, não conteúdo. */
  readonly identifier: string;
  /** Nome de exibição estrutural (ex.: "Artigo 1º"). */
  readonly displayName: string;
  readonly parent: string | null;
  readonly children: readonly string[];
  readonly order: number;
  readonly authority: string;
  readonly scope: string;
  /** Ligação futura com conhecimento jurídico (Part 4) — SEMPRE null nesta RC. */
  readonly knowledgeUnitId: string | null;
  readonly version: number;
  /** Linhagem estável do ato normativo (mesmo tenant+norma → mesma linhagem). */
  readonly lineageId: string;
  readonly metadata: NormativeMetadata;
  /** Hash determinístico dos campos estruturais (replay-safe). */
  readonly replayHash: string;
}

export function computeNormativeLineage(params: { tenantId: number; normId: string }): string {
  return createHash("sha256").update(`nlin:${params.tenantId}:${params.normId}`).digest("hex").slice(0, 20);
}

/** Id determinístico de um nó (independe de filhos/ordem) — permite montar a árvore em 1 passo. */
export function normativeNodeId(tenantId: number, normId: string, type: NormativeLevelId, identifier: string): string {
  return createHash("sha256").update(`nnode:${tenantId}:${normId}:${type}:${identifier}`).digest("hex").slice(0, 20);
}

function computeReplayHash(n: Omit<NormativeNode, "id" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: n.tenantId, norm: n.normId, type: n.type, identifier: n.identifier, displayName: n.displayName,
    parent: n.parent, children: [...n.children].sort(), order: n.order, authority: n.authority, scope: n.scope,
    knowledgeUnitId: n.knowledgeUnitId, version: n.version, lineage: n.lineageId, metadata: n.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateNormativeNodeParams {
  tenantId: number;
  normId: string;
  type: NormativeLevelId;
  identifier: string;
  displayName?: string;
  parent?: string | null;
  children?: string[];
  order?: number;
  authority?: string;
  scope?: string;
  knowledgeUnitId?: string | null;
  version?: number;
  metadata?: NormativeMetadata;
}

/** Cria um nó normativo estrutural. Determinístico. `knowledgeUnitId` nulo nesta RC. */
export function createNormativeNode(params: CreateNormativeNodeParams): NormativeNode {
  const version = params.version ?? 1;
  const lineageId = computeNormativeLineage({ tenantId: params.tenantId, normId: params.normId });
  const base: Omit<NormativeNode, "id" | "replayHash"> = {
    tenantId: params.tenantId, normId: params.normId, type: params.type, identifier: params.identifier,
    displayName: params.displayName ?? params.identifier, parent: params.parent ?? null,
    children: params.children ?? [], order: params.order ?? 0, authority: params.authority ?? "Congresso Nacional",
    scope: params.scope ?? "federal", knowledgeUnitId: params.knowledgeUnitId ?? null, version, lineageId,
    metadata: params.metadata ?? {},
  };
  const replayHash = computeReplayHash(base);
  const id = normativeNodeId(params.tenantId, params.normId, params.type, params.identifier);
  return { id, ...base, replayHash };
}

export function isValidNormativeNode(n: NormativeNode): boolean {
  return isNormativeLevel(n.type) && n.tenantId > 0 && n.normId.length > 0 && n.identifier.length > 0 && n.version >= 1;
}
