/**
 * RC-4.6 — Federal Procurement Corpus Package · Queries (Part 8).
 *
 * API DECLARATIVA de consulta sobre pacotes de corpus (e um registro). Sem banco.
 * Determinística (ordenação estável). Multi-tenant (opera sobre os dados fornecidos).
 */

import type { CorpusPackage } from "./corpusPackage";
import type { CorpusManifest, CompatibilitySpec, PackageDependency } from "./corpusManifest";
import type { CollectionManifest } from "./collectionManifest";
import type { CorpusPackageRegistry, PackageRegistryEntry } from "./corpusPackageRegistry";

/** Pacote por id, buscando numa lista de pacotes. */
export function findPackage(packages: readonly CorpusPackage[], packageId: string): CorpusPackage | null {
  return packages.find(p => p.id === packageId) ?? null;
}

/** Coleções de um pacote (ordenadas). */
export function findCollections(pkg: CorpusPackage): CollectionManifest[] {
  return [...pkg.collections].sort((a, b) => a.id.localeCompare(b.id));
}

/** Manifesto de um pacote. */
export function findManifest(pkg: CorpusPackage): CorpusManifest {
  return pkg.manifest;
}

/** Dependências (entre pacotes) declaradas pelo manifesto. */
export function findDependencies(pkg: CorpusPackage): PackageDependency[] {
  return [...pkg.manifest.dependencies].sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/** Especificação de compatibilidade do pacote. */
export function findCompatibility(pkg: CorpusPackage): CompatibilitySpec {
  return pkg.manifest.compatibility;
}

/** Versões registradas de um pacote (por nome) num registro. */
export function findVersions(registry: CorpusPackageRegistry, name: string): string[] {
  return registry.entries.filter(e => e.name === name).map(e => e.version).sort((a, b) => a.localeCompare(b));
}

/** Autoridade emissora do pacote. */
export function findAuthority(pkg: CorpusPackage): string {
  return pkg.manifest.authority;
}

/** Escopo do pacote. */
export function findScope(pkg: CorpusPackage): string {
  return pkg.manifest.scope;
}

/** Entradas de um registro para um pacote específico (todas as versões). */
export function findRegistryVersions(registry: CorpusPackageRegistry, name: string): PackageRegistryEntry[] {
  return registry.entries.filter(e => e.name === name).sort((a, b) => a.version.localeCompare(b.version));
}
