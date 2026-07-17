/**
 * RC-4.6 — Federal Procurement Corpus Package · CorpusManifest (Part 1).
 *
 * Representa OFICIALMENTE um Corpus instalável. Estrutura declarativa — NÃO contém conteúdo
 * jurídico (artigos, incisos, parágrafos, Lei 14.133 detalhada, acórdãos, doutrina). Multi-tenant,
 * determinístico (id/replayHash via sha256). Reutilizável para qualquer Corpus futuro.
 */

import { createHash } from "crypto";
import { isValidVersion } from "./semver";

/** Faixas/versões com que o pacote é compatível. */
export interface CompatibilitySpec {
  /** Versão mínima da plataforma LiciGov Pro. */
  readonly platform: string;
  /** Versão do Institutional Corpus Framework (RC-4.5.1) exigida. */
  readonly corpusFramework: string;
  /** Versão do schema do manifesto. */
  readonly schema: string;
}

/** Dependência declarativa entre pacotes de corpus. */
export interface PackageDependency {
  readonly packageName: string;
  /** Faixa de versão exigida (ex.: ">=1.0.0"). */
  readonly versionRange: string;
}

export interface CorpusManifest {
  readonly id: string;
  readonly tenantId: number;
  readonly name: string;
  readonly description: string;
  /** Autoridade emissora do corpus (ex.: "Governo Federal"). */
  readonly authority: string;
  readonly jurisdiction: string;
  readonly language: string;
  readonly scope: string;
  /** Versão semver do corpus. */
  readonly version: string;
  readonly compatibility: CompatibilitySpec;
  readonly dependencies: readonly PackageDependency[];
  /** Ids das coleções (CollectionManifest) que compõem o corpus. */
  readonly collections: readonly string[];
  readonly metadata: Record<string, unknown>;
  /** Hash determinístico dos campos estruturais (replay-safe). */
  readonly replayHash: string;
}

function computeReplayHash(m: Omit<CorpusManifest, "id" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: m.tenantId, name: m.name, description: m.description, authority: m.authority,
    jurisdiction: m.jurisdiction, language: m.language, scope: m.scope, version: m.version,
    compatibility: m.compatibility, dependencies: [...m.dependencies].map(d => `${d.packageName}@${d.versionRange}`).sort(),
    collections: [...m.collections].sort(), metadata: m.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateCorpusManifestParams {
  tenantId: number;
  name: string;
  description?: string;
  authority: string;
  jurisdiction: string;
  language?: string;
  scope: string;
  version: string;
  compatibility: CompatibilitySpec;
  dependencies?: PackageDependency[];
  collections?: string[];
  metadata?: Record<string, unknown>;
}

/** Cria um manifesto de corpus. Determinístico. */
export function createCorpusManifest(params: CreateCorpusManifestParams): CorpusManifest {
  const base = {
    tenantId: params.tenantId, name: params.name, description: params.description ?? "",
    authority: params.authority, jurisdiction: params.jurisdiction, language: params.language ?? "pt-BR",
    scope: params.scope, version: params.version, compatibility: params.compatibility,
    dependencies: params.dependencies ?? [], collections: params.collections ?? [], metadata: params.metadata ?? {},
  };
  const replayHash = computeReplayHash(base);
  const id = createHash("sha256").update(`corpusmanifest:${params.tenantId}:${params.name}:${params.version}`).digest("hex").slice(0, 20);
  return { id, ...base, replayHash };
}

export function isValidManifest(m: CorpusManifest): boolean {
  return m.tenantId > 0 && m.name.length > 0 && m.authority.length > 0 && isValidVersion(m.version)
    && isValidVersion(m.compatibility.platform) && isValidVersion(m.compatibility.corpusFramework);
}
