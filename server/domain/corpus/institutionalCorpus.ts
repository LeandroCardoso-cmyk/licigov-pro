/**
 * RC-4.5.1 — Institutional Corpus Framework · InstitutionalCorpus (Part 1).
 *
 * Unidade organizacional PERMANENTE onde todo conhecimento institucional será agrupado.
 * NÃO contém conhecimento jurídico — apenas a estrutura organizacional. Multi-tenant,
 * determinística (id/lineage/replayHash via sha256; sem Date.now em ids), versionável
 * (append-only, nunca sobrescreve). Reutiliza os tipos de corpus (Part 2).
 */

import { createHash } from "crypto";
import { isCorpusType, type CorpusTypeId } from "./corpusTypes";

/** Ciclo de vida do corpus (Part 9). */
export type CorpusStatus = "draft" | "active" | "deprecated" | "archived";

export interface InstitutionalCorpus {
  readonly id: string;
  readonly tenantId: number;
  readonly name: string;
  readonly description: string;
  readonly type: CorpusTypeId;
  /** Nível de escopo/abrangência (configurável — Part 4). Ex.: "uniao", "estado", "municipio". */
  readonly scope: string;
  readonly jurisdiction: string;
  /** Responsável institucional pelo corpus. */
  readonly owner: string;
  /** Corpus pai na hierarquia (Part 4) — null = raiz. */
  readonly parentId: string | null;
  readonly version: number;
  readonly status: CorpusStatus;
  readonly language: string;
  /** Linhagem estável (mesma origem institucional → mesma linhagem; versões acumulam). */
  readonly lineageId: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Hash determinístico dos campos estruturais (replay-safe; NÃO inclui createdAt/updatedAt/id). */
  readonly replayHash: string;
}

/** Linhagem estável de um corpus (independente da versão e do status). */
export function computeCorpusLineage(params: { tenantId: number; type: string; owner: string; name: string }): string {
  return createHash("sha256").update(`corpuslin:${params.tenantId}:${params.type}:${params.owner}:${params.name}`).digest("hex").slice(0, 20);
}

function computeReplayHash(c: Omit<InstitutionalCorpus, "id" | "createdAt" | "updatedAt" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: c.tenantId, name: c.name, description: c.description, type: c.type, scope: c.scope,
    jurisdiction: c.jurisdiction, owner: c.owner, parent: c.parentId, version: c.version,
    status: c.status, language: c.language, lineage: c.lineageId, metadata: c.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateInstitutionalCorpusParams {
  tenantId: number;
  name: string;
  description?: string;
  type: CorpusTypeId;
  scope: string;
  jurisdiction: string;
  owner: string;
  parentId?: string | null;
  version?: number;
  status?: CorpusStatus;
  language?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/** Cria (ou versiona) um corpus institucional. Determinístico; nunca sobrescreve. */
export function createInstitutionalCorpus(params: CreateInstitutionalCorpusParams): InstitutionalCorpus {
  const version = params.version ?? 1;
  const lineageId = computeCorpusLineage({ tenantId: params.tenantId, type: params.type, owner: params.owner, name: params.name });
  const base = {
    tenantId: params.tenantId, name: params.name, description: params.description ?? "", type: params.type,
    scope: params.scope, jurisdiction: params.jurisdiction, owner: params.owner, parentId: params.parentId ?? null,
    version, status: params.status ?? "draft" as CorpusStatus, language: params.language ?? "pt-BR",
    lineageId, metadata: params.metadata ?? {},
  };
  const replayHash = computeReplayHash(base);
  const id = createHash("sha256").update(`corpus:${params.tenantId}:${lineageId}:${version}`).digest("hex").slice(0, 20);
  const createdAt = params.createdAt ?? new Date().toISOString();
  return { id, ...base, createdAt, updatedAt: params.updatedAt ?? createdAt, replayHash };
}

export function isValidCorpus(c: InstitutionalCorpus): boolean {
  return isCorpusType(c.type) && c.tenantId > 0 && c.version >= 1 && c.name.length > 0 && c.owner.length > 0;
}
