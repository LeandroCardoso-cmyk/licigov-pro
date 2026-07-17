/**
 * RC-4.6 — Federal Procurement Corpus Package · Explainability (Part 9).
 *
 * Todo Package se EXPLICA: origem, autoridade, versão, escopo, coleções, dependências e
 * compatibilidade. Nunca retorna apenas dados; nunca existe informação implícita. Determinístico.
 */

import type { CorpusPackage } from "./corpusPackage";

export interface PackageExplanation {
  readonly packageId: string;
  readonly origin: { readonly name: string; readonly jurisdiction: string; readonly lifecycle: string };
  readonly authority: string;
  readonly version: string;
  readonly scope: string;
  readonly collections: readonly { readonly id: string; readonly name: string; readonly category: string; readonly units: number }[];
  readonly dependencies: readonly { readonly packageName: string; readonly versionRange: string }[];
  readonly compatibility: { readonly platform: string; readonly corpusFramework: string; readonly schema: string };
  readonly integrity: { readonly checksumAlg: string; readonly packageChecksum: string };
  readonly summary: string;
}

/** Explica um pacote de corpus. Sempre estruturado — nunca só dados. */
export function explainPackage(pkg: CorpusPackage): PackageExplanation {
  return {
    packageId: pkg.id,
    origin: { name: pkg.manifest.name, jurisdiction: pkg.manifest.jurisdiction, lifecycle: pkg.lifecycle },
    authority: pkg.manifest.authority,
    version: pkg.version,
    scope: pkg.manifest.scope,
    collections: [...pkg.collections].sort((a, b) => a.id.localeCompare(b.id)).map(c => ({ id: c.id, name: c.name, category: c.category, units: c.knowledgeUnits.length })),
    dependencies: [...pkg.manifest.dependencies].map(d => ({ packageName: d.packageName, versionRange: d.versionRange })),
    compatibility: { platform: pkg.manifest.compatibility.platform, corpusFramework: pkg.manifest.compatibility.corpusFramework, schema: pkg.manifest.compatibility.schema },
    integrity: { checksumAlg: pkg.integrity.checksumAlg, packageChecksum: pkg.integrity.packageChecksum },
    summary: `Pacote ${pkg.manifest.name} v${pkg.version} (${pkg.lifecycle}), autoridade ${pkg.manifest.authority}, escopo ${pkg.manifest.scope}, ${pkg.collections.length} coleções — sem conteúdo jurídico.`,
  };
}
