/**
 * RC-4.6 — Federal Procurement Corpus Package · Package Validation (Part 6).
 *
 * Valida — SEM instalação — Manifest, Dependencies, Collections, Replay Hash, Checksums e Version.
 * Determinística. Não conecta banco, IA ou providers.
 */

import type { CorpusPackage } from "./corpusPackage";
import { verifyPackageIntegrity } from "./corpusPackage";
import { isValidManifest } from "./corpusManifest";
import { isValidCollectionManifest } from "./collectionManifest";
import { isValidVersion, satisfies } from "./semver";

export interface PackageValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validatePackage(pkg: CorpusPackage): PackageValidation {
  const errors: string[] = [];

  // Manifest.
  if (!isValidManifest(pkg.manifest)) errors.push("manifesto inválido (tenant/nome/autoridade/versão/compatibilidade)");
  if (pkg.manifest.tenantId !== pkg.tenantId) errors.push("manifesto: tenant divergente do pacote");

  // Version.
  if (!isValidVersion(pkg.version)) errors.push(`versão do pacote inválida: ${pkg.version}`);
  if (pkg.version !== pkg.manifest.version) errors.push("versão do pacote diverge da versão do manifesto");

  // Collections: válidas, mesmo tenant, referenciadas pelo manifesto, dependências existentes.
  const collectionIds = new Set<string>();
  for (const c of pkg.collections) {
    if (collectionIds.has(c.id)) errors.push(`coleção com id duplicado: ${c.id}`);
    collectionIds.add(c.id);
    if (!isValidCollectionManifest(c)) errors.push(`coleção inválida: ${c.name}`);
    if (c.tenantId !== pkg.tenantId) errors.push(`coleção ${c.name}: tenant divergente`);
    if (c.knowledgeUnits.length > 0) errors.push(`coleção ${c.name}: não deve conter conhecimento nesta versão`);
  }
  for (const c of pkg.collections) {
    for (const dep of c.dependencies) {
      if (!collectionIds.has(dep)) errors.push(`coleção ${c.name}: dependência inexistente ${dep}`);
    }
  }
  // O manifesto deve referenciar exatamente as coleções presentes.
  for (const id of pkg.manifest.collections) {
    if (!collectionIds.has(id)) errors.push(`manifesto referencia coleção ausente: ${id}`);
  }
  for (const id of collectionIds) {
    if (!pkg.manifest.collections.includes(id)) errors.push(`coleção ${id} não referenciada pelo manifesto`);
  }

  // Dependencies (entre pacotes): faixa de versão válida.
  for (const d of pkg.manifest.dependencies) {
    if (!/^(>=)?\d+\.\d+\.\d+$/.test(d.versionRange.trim())) errors.push(`dependência ${d.packageName}: faixa inválida ${d.versionRange}`);
  }

  // Compatibility.
  if (!isValidVersion(pkg.manifest.compatibility.platform)) errors.push("compatibilidade: versão de plataforma inválida");
  if (!isValidVersion(pkg.manifest.compatibility.corpusFramework)) errors.push("compatibilidade: versão de framework inválida");

  // Replay Hash / Checksums (integridade).
  if (pkg.replayHash.length !== 32) errors.push("replayHash do pacote com tamanho inesperado");
  if (!verifyPackageIntegrity(pkg)) errors.push("checksums de integridade não conferem");

  return { valid: errors.length === 0, errors };
}

/** Verifica compatibilidade de um pacote com uma versão de plataforma/framework. */
export function isPackageCompatible(pkg: CorpusPackage, platformVersion: string, frameworkVersion: string): boolean {
  return satisfies(platformVersion, `>=${pkg.manifest.compatibility.platform}`)
    && satisfies(frameworkVersion, `>=${pkg.manifest.compatibility.corpusFramework}`);
}
