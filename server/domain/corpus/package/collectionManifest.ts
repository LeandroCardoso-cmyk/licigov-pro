/**
 * RC-4.6 — Federal Procurement Corpus Package · CollectionManifest (Part 3).
 *
 * Descreve OFICIALMENTE uma coleção do corpus. NESTA RC toda coleção é VAZIA (nenhum
 * conhecimento é inserido — `knowledgeUnits` sempre vazio). Estrutura declarativa,
 * multi-tenant, determinística (id/replayHash via sha256).
 */

import { createHash } from "crypto";
import { isValidVersion } from "./semver";

export interface CollectionManifest {
  readonly id: string;
  readonly tenantId: number;
  readonly name: string;
  readonly description: string;
  /** Categoria estrutural (ex.: "lei", "decreto", "instrucao_normativa", "parecer", "acordao"). */
  readonly category: string;
  readonly version: string;
  readonly authority: string;
  /** Ids de outras coleções das quais esta depende. */
  readonly dependencies: readonly string[];
  /** Unidades de conhecimento — SEMPRE vazio nesta RC (sem conteúdo). */
  readonly knowledgeUnits: readonly string[];
  readonly replayHash: string;
}

function computeReplayHash(c: Omit<CollectionManifest, "id" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: c.tenantId, name: c.name, description: c.description, category: c.category,
    version: c.version, authority: c.authority, dependencies: [...c.dependencies].sort(),
    knowledgeUnits: [...c.knowledgeUnits].sort(),
  })).digest("hex").slice(0, 32);
}

export interface CreateCollectionManifestParams {
  tenantId: number;
  name: string;
  description?: string;
  category: string;
  version: string;
  authority: string;
  dependencies?: string[];
  /** Aceito para compatibilidade futura; nesta RC deve permanecer vazio. */
  knowledgeUnits?: string[];
}

/** Cria um manifesto de coleção (vazio nesta RC). Determinístico. */
export function createCollectionManifest(params: CreateCollectionManifestParams): CollectionManifest {
  const base = {
    tenantId: params.tenantId, name: params.name, description: params.description ?? "",
    category: params.category, version: params.version, authority: params.authority,
    dependencies: params.dependencies ?? [], knowledgeUnits: params.knowledgeUnits ?? [],
  };
  const replayHash = computeReplayHash(base);
  const id = createHash("sha256").update(`colmanifest:${params.tenantId}:${params.name}:${params.version}`).digest("hex").slice(0, 20);
  return { id, ...base, replayHash };
}

export function isValidCollectionManifest(c: CollectionManifest): boolean {
  return c.tenantId > 0 && c.name.length > 0 && c.authority.length > 0 && isValidVersion(c.version) && c.category.length > 0;
}
