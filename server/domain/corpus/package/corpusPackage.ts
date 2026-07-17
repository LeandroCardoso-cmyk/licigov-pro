/**
 * RC-4.6 — Federal Procurement Corpus Package · CorpusPackage (Part 2).
 *
 * Representa um Corpus instalável como PACOTE: Manifest, Collections, Knowledge Units (vazias
 * nesta RC), Version, Integrity, Replay Hash, Checksums e Lifecycle. Sem banco. Determinístico,
 * multi-tenant. Não instala nada — apenas representa. NÃO contém conteúdo jurídico.
 */

import { createHash } from "crypto";
import type { CorpusManifest } from "./corpusManifest";
import type { CollectionManifest } from "./collectionManifest";

/** Ciclo de vida do pacote. */
export type PackageLifecycle = "draft" | "registered" | "validated" | "active" | "deprecated";

export interface PackageIntegrity {
  readonly checksumAlg: "sha256";
  /** Checksum consolidado do pacote (manifest + coleções). */
  readonly packageChecksum: string;
  /** Checksum por coleção (id → checksum). */
  readonly collectionChecksums: Readonly<Record<string, string>>;
}

export interface CorpusPackage {
  readonly id: string;
  readonly tenantId: number;
  readonly manifest: CorpusManifest;
  readonly collections: readonly CollectionManifest[];
  /** Unidades de conhecimento — SEMPRE vazio nesta RC. */
  readonly knowledgeUnits: readonly string[];
  readonly version: string;
  readonly lifecycle: PackageLifecycle;
  readonly integrity: PackageIntegrity;
  readonly replayHash: string;
  readonly createdAt: string;
}

function checksum(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function computeIntegrity(manifest: CorpusManifest, collections: readonly CollectionManifest[]): PackageIntegrity {
  const collectionChecksums: Record<string, string> = {};
  for (const c of [...collections].sort((a, b) => a.id.localeCompare(b.id))) {
    collectionChecksums[c.id] = checksum({ id: c.id, replayHash: c.replayHash });
  }
  const packageChecksum = checksum({ manifest: manifest.replayHash, collections: Object.values(collectionChecksums).sort() });
  return { checksumAlg: "sha256", packageChecksum, collectionChecksums };
}

export interface CreateCorpusPackageParams {
  tenantId: number;
  manifest: CorpusManifest;
  collections: CollectionManifest[];
  version?: string;
  lifecycle?: PackageLifecycle;
  createdAt?: string;
}

/** Monta um pacote de corpus a partir do manifesto e coleções. Determinístico. */
export function createCorpusPackage(params: CreateCorpusPackageParams): CorpusPackage {
  const version = params.version ?? params.manifest.version;
  const integrity = computeIntegrity(params.manifest, params.collections);
  const replayHash = createHash("sha256").update(JSON.stringify({
    tenant: params.tenantId, manifest: params.manifest.replayHash, version,
    collections: [...params.collections].map(c => c.replayHash).sort(), integrity: integrity.packageChecksum,
  })).digest("hex").slice(0, 32);
  const id = createHash("sha256").update(`corpuspkg:${params.tenantId}:${params.manifest.name}:${version}`).digest("hex").slice(0, 20);
  return {
    id, tenantId: params.tenantId, manifest: params.manifest, collections: params.collections,
    knowledgeUnits: [], version, lifecycle: params.lifecycle ?? "draft", integrity, replayHash,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Recalcula a integridade e confirma se o pacote não foi adulterado. Determinístico. */
export function verifyPackageIntegrity(pkg: CorpusPackage): boolean {
  const recomputed = computeIntegrity(pkg.manifest, pkg.collections);
  if (recomputed.packageChecksum !== pkg.integrity.packageChecksum) return false;
  const ids = new Set([...Object.keys(recomputed.collectionChecksums), ...Object.keys(pkg.integrity.collectionChecksums)]);
  for (const id of ids) {
    if (recomputed.collectionChecksums[id] !== pkg.integrity.collectionChecksums[id]) return false;
  }
  return true;
}

/** Transição de ciclo de vida (append-only — retorna novo pacote; nunca sobrescreve). */
export function transitionLifecycle(pkg: CorpusPackage, lifecycle: PackageLifecycle): CorpusPackage {
  return { ...pkg, lifecycle };
}
