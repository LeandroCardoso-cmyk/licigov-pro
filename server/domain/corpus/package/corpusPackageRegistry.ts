/**
 * RC-4.6 — Federal Procurement Corpus Package · Package Registry (Part 5).
 *
 * Registro OFICIAL e DECLARATIVO de pacotes de corpus instaláveis. Permite registrar o
 * Federal Procurement Corpus (e futuros pacotes) — SEM instalação, SEM banco. Multi-tenant,
 * determinístico, append-only.
 */

import { createHash } from "crypto";
import type { CorpusPackage } from "./corpusPackage";

export interface PackageRegistryEntry {
  readonly packageId: string;
  readonly name: string;
  readonly version: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly scope: string;
  readonly lifecycle: CorpusPackage["lifecycle"];
  readonly collections: number;
  readonly replayHash: string;
}

export interface CorpusPackageRegistry {
  readonly id: string;
  readonly tenantId: number;
  readonly name: string;
  readonly entries: readonly PackageRegistryEntry[];
}

function toEntry(pkg: CorpusPackage): PackageRegistryEntry {
  return {
    packageId: pkg.id, name: pkg.manifest.name, version: pkg.version, authority: pkg.manifest.authority,
    jurisdiction: pkg.manifest.jurisdiction, scope: pkg.manifest.scope, lifecycle: pkg.lifecycle,
    collections: pkg.collections.length, replayHash: pkg.replayHash,
  };
}

/** Cria um registro vazio de pacotes. Determinístico. */
export function createCorpusPackageRegistry(tenantId: number, name: string): CorpusPackageRegistry {
  const id = createHash("sha256").update(`corpuspkgreg:${tenantId}:${name}`).digest("hex").slice(0, 20);
  return { id, tenantId, name, entries: [] };
}

/** Registra um pacote (append-only; idempotente por packageId; multi-tenant). */
export function registerPackage(registry: CorpusPackageRegistry, pkg: CorpusPackage): CorpusPackageRegistry {
  if (pkg.tenantId !== registry.tenantId) throw new Error("registerPackage: isolamento multi-tenant violado");
  if (registry.entries.some(e => e.packageId === pkg.id)) return registry;
  const entries = [...registry.entries, toEntry(pkg)].sort((a, b) => a.packageId.localeCompare(b.packageId));
  return { ...registry, entries };
}

export function findRegistryEntry(registry: CorpusPackageRegistry, packageId: string): PackageRegistryEntry | null {
  return registry.entries.find(e => e.packageId === packageId) ?? null;
}

/** Entradas por nome (todas as versões registradas). */
export function registryEntriesByName(registry: CorpusPackageRegistry, name: string): PackageRegistryEntry[] {
  return registry.entries.filter(e => e.name === name).sort((a, b) => a.version.localeCompare(b.version));
}
