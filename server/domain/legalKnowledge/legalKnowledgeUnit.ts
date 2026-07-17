/**
 * RC-4.5 — Legal Knowledge Foundation · LegalKnowledgeUnit (estrutura, não conteúdo).
 *
 * Modelo/container PERMANENTE para armazenar QUALQUER conhecimento jurídico institucional
 * futuro — SEM inserir Lei 14.133, jurisprudência, acórdãos ou doutrina. Apenas a estrutura.
 * Multi-tenant, determinístico (id/lineage/replayHash via sha256; sem Date.now em ids),
 * versionável (nunca sobrescreve). Reutiliza os tipos da Ontologia Jurídica (RC-4.4).
 */

import { createHash } from "crypto";
import { isNormType, type NormTypeId } from "../legal/normTypes";

export type KnowledgeValidity = "vigente" | "revogado" | "suspenso" | "projeto";
export type Jurisdiction = "federal" | "estadual" | "municipal" | "distrital" | "internacional";

export interface LegalKnowledgeUnit {
  readonly id: string;
  readonly tenantId: number;
  /** Tipo normativo (Ontologia Jurídica RC-4.4). */
  readonly type: NormTypeId;
  readonly title: string;
  readonly description: string;
  /** Nível hierárquico (menor = mais alto). */
  readonly hierarchy: number;
  readonly jurisdiction: Jurisdiction;
  readonly validity: KnowledgeValidity;
  /** Referência de origem (identificador estrutural — nunca conteúdo). */
  readonly sourceReference: string;
  readonly effectiveDate: string | null;
  readonly revokedDate: string | null;
  readonly version: number;
  /** Linhagem estável (mesma origem+tipo → mesma linhagem; versões acumulam). */
  readonly lineageId: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  /** Hash determinístico dos campos estruturais (replay-safe; NÃO inclui createdAt). */
  readonly replayHash: string;
}

/** Linhagem estável de uma unidade (independente da versão). */
export function computeKnowledgeLineage(params: { tenantId: number; type: string; sourceReference: string }): string {
  return createHash("sha256").update(`lkl:${params.tenantId}:${params.type}:${params.sourceReference}`).digest("hex").slice(0, 20);
}

function computeReplayHash(u: Omit<LegalKnowledgeUnit, "id" | "createdAt" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: u.tenantId, type: u.type, title: u.title, description: u.description, hierarchy: u.hierarchy,
    jurisdiction: u.jurisdiction, validity: u.validity, source: u.sourceReference,
    effective: u.effectiveDate, revoked: u.revokedDate, version: u.version, lineage: u.lineageId, metadata: u.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateLegalKnowledgeUnitParams {
  tenantId: number;
  type: NormTypeId;
  title: string;
  description?: string;
  hierarchy: number;
  jurisdiction: Jurisdiction;
  validity?: KnowledgeValidity;
  sourceReference: string;
  effectiveDate?: string | null;
  revokedDate?: string | null;
  version?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

/** Cria (ou versiona) uma unidade de conhecimento jurídico. Determinística; nunca sobrescreve. */
export function createLegalKnowledgeUnit(params: CreateLegalKnowledgeUnitParams): LegalKnowledgeUnit {
  const version = params.version ?? 1;
  const lineageId = computeKnowledgeLineage({ tenantId: params.tenantId, type: params.type, sourceReference: params.sourceReference });
  const base = {
    tenantId: params.tenantId, type: params.type, title: params.title, description: params.description ?? "",
    hierarchy: params.hierarchy, jurisdiction: params.jurisdiction, validity: params.validity ?? "vigente",
    sourceReference: params.sourceReference, effectiveDate: params.effectiveDate ?? null, revokedDate: params.revokedDate ?? null,
    version, lineageId, metadata: params.metadata ?? {},
  };
  const replayHash = computeReplayHash(base);
  const id = createHash("sha256").update(`lku:${params.tenantId}:${lineageId}:${version}`).digest("hex").slice(0, 20);
  return { id, ...base, createdAt: params.createdAt ?? new Date().toISOString(), replayHash };
}

export function isValidUnit(u: LegalKnowledgeUnit): boolean {
  return isNormType(u.type) && u.hierarchy >= 0 && u.version >= 1 && u.tenantId > 0;
}
