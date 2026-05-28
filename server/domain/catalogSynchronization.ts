/**
 * Sprint 2.95 — Catalog Synchronization Domain.
 *
 * Fundação para sincronização futura com catálogos CATMAT/CATSER.
 * Nesta sprint: estruturas de dados, metadados de integridade e versionamento.
 * Integração real com a API CATMAT/CATSER é escopo de sprint futura.
 *
 * Referência: Catálogo de Materiais do COMPRAS.GOV.BR (CATMAT/CATSER).
 */

import { nanoid } from "nanoid";
import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CatalogType = "catmat" | "catser" | "custom";

export type SyncStatus =
  | "pending"   // aguardando primeira sincronização
  | "syncing"   // sincronização em andamento
  | "synced"    // sincronizado com sucesso
  | "failed"    // falha na última tentativa de sincronização
  | "stale";    // dados expirados, requer re-sincronização

export type SyncOperation =
  | "create"      // criação do snapshot inicial
  | "update"      // atualização com nova versão do catálogo
  | "verify"      // verificação de integridade sem atualização
  | "invalidate"  // invalidação forçada por inconsistência
  | "expire";     // expiração por tempo (TTL atingido)

// ─── Metadata types ───────────────────────────────────────────────────────────

export interface IntegrityMetadata {
  checksumAlg: string;
  verifiedAt:  string | null;
  isValid:     boolean;
}

export interface CacheMetadata {
  cachedAt:  string;
  expiresAt: string;
  stale:     boolean;
}

// ─── Catalog Snapshot ─────────────────────────────────────────────────────────

export interface CatalogSnapshot {
  id:               string;
  organizationId:   number;
  catalogType:      CatalogType;
  version:          string;
  sourceUrl:        null;        // sempre null nesta sprint
  checksum:         string;
  totalEntries:     number;
  indexedEntries:   number;
  syncStatus:       SyncStatus;
  snapshotLineage:  string | null; // id do snapshot anterior
  importLineage:    string[];       // ids de sessões de importação relacionadas
  integrityMetadata: IntegrityMetadata;
  cacheMetadata:    CacheMetadata;
  createdAt:        string;
  updatedAt:        string;
}

// ─── Catalog Sync History ─────────────────────────────────────────────────────

export interface CatalogSyncHistory {
  id:            string;
  snapshotId:    string;
  organizationId: number;
  operation:     SyncOperation;
  beforeVersion: string | null;
  afterVersion:  string;
  actor:         string;          // userId (string) ou "system"
  reason:        string;
  occurredAt:    string;
}

// ─── Checksum computation ─────────────────────────────────────────────────────

/**
 * Computa checksum SHA-256 hex de uma string.
 * Determinístico: mesma entrada → mesmo hash sempre.
 */
export function computeChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ─── Factory: createSnapshot ──────────────────────────────────────────────────

export function createSnapshot(
  orgId:       number,
  catalogType: CatalogType,
  version:     string,
  totalEntries: number,
  checksum:    string,
  params: {
    indexedEntries?:  number;
    snapshotLineage?: string | null;
    importLineage?:   string[];
    ttlMs?:           number;          // default 24h
  } = {},
): CatalogSnapshot {
  const now = new Date().toISOString();
  const ttlMs = params.ttlMs ?? 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  return {
    id:              nanoid(),
    organizationId:  orgId,
    catalogType,
    version,
    sourceUrl:       null,
    checksum,
    totalEntries,
    indexedEntries:  params.indexedEntries ?? totalEntries,
    syncStatus:      "pending",
    snapshotLineage: params.snapshotLineage ?? null,
    importLineage:   params.importLineage ?? [],
    integrityMetadata: {
      checksumAlg: "sha256",
      verifiedAt:  null,
      isValid:     checksum.length > 0,
    },
    cacheMetadata: {
      cachedAt:  now,
      expiresAt,
      stale:     false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Factory: addToHistory ────────────────────────────────────────────────────

export function addToHistory(
  snapshot:     CatalogSnapshot,
  operation:    SyncOperation,
  afterVersion: string,
  actor:        string,
  reason:       string,
  beforeVersion?: string | null,
): CatalogSyncHistory {
  return {
    id:             nanoid(),
    snapshotId:     snapshot.id,
    organizationId: snapshot.organizationId,
    operation,
    beforeVersion:  beforeVersion ?? null,
    afterVersion,
    actor,
    reason,
    occurredAt:     new Date().toISOString(),
  };
}

// ─── Staleness check ──────────────────────────────────────────────────────────

/**
 * Verifica se o snapshot está stale com base no expiresAt.
 * Independente do campo cacheMetadata.stale — verifica o tempo real.
 */
export function isSnapshotStale(
  snapshot: CatalogSnapshot,
  maxAgeMs: number,
): boolean {
  const expiresAt = new Date(snapshot.cacheMetadata.expiresAt).getTime();
  const ageMs = Date.now() - new Date(snapshot.cacheMetadata.cachedAt).getTime();
  return Date.now() > expiresAt || ageMs >= maxAgeMs;
}

// ─── Integrity verification ───────────────────────────────────────────────────

/**
 * Verifica integridade básica do snapshot.
 * Retorna true se o checksum é não-vazio e integrityMetadata.isValid.
 */
export function verifyIntegrity(snapshot: CatalogSnapshot): boolean {
  return snapshot.integrityMetadata.isValid && snapshot.checksum.length > 0;
}

// ─── Mark stale ───────────────────────────────────────────────────────────────

/**
 * Retorna novo snapshot marcado como stale (imutável).
 */
export function markStale(snapshot: CatalogSnapshot): CatalogSnapshot {
  return {
    ...snapshot,
    syncStatus: "stale",
    cacheMetadata: {
      ...snapshot.cacheMetadata,
      stale: true,
    },
    updatedAt: new Date().toISOString(),
  };
}
