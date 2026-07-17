/**
 * RC-4.5.1 — Institutional Corpus Framework · Corpus Registry (Part 5).
 *
 * Registro OFICIAL e DECLARATIVO de corpora institucionais. Permite catalogar centenas de
 * corpora (Federal, Estadual, Municipal, Institucional, …) e navegar sua organização —
 * sem banco. Multi-tenant, determinístico, append-only. Nenhum conteúdo jurídico.
 */

import { createHash } from "crypto";
import type { InstitutionalCorpus } from "./institutionalCorpus";
import type { CorpusTypeId } from "./corpusTypes";

export interface CorpusRegistryEntry {
  readonly corpusId: string;
  readonly name: string;
  readonly type: CorpusTypeId;
  readonly scope: string;
  readonly parentId: string | null;
  readonly status: InstitutionalCorpus["status"];
  readonly version: number;
}

export interface CorpusRegistry {
  readonly id: string;
  readonly tenantId: number;
  readonly name: string;
  readonly entries: readonly CorpusRegistryEntry[];
}

function toEntry(c: InstitutionalCorpus): CorpusRegistryEntry {
  return { corpusId: c.id, name: c.name, type: c.type, scope: c.scope, parentId: c.parentId, status: c.status, version: c.version };
}

/** Constrói um registro declarativo a partir de um conjunto de corpora. Determinístico. */
export function buildCorpusRegistry(tenantId: number, name: string, corpora: readonly InstitutionalCorpus[]): CorpusRegistry {
  const id = createHash("sha256").update(`corpusreg:${tenantId}:${name}`).digest("hex").slice(0, 20);
  const entries = corpora
    .filter(c => c.tenantId === tenantId)
    .map(toEntry)
    .sort((a, b) => a.corpusId.localeCompare(b.corpusId));
  return { id, tenantId, name, entries };
}

/** Registra um corpus no registro (append-only; idempotente por corpusId). */
export function registerCorpus(registry: CorpusRegistry, corpus: InstitutionalCorpus): CorpusRegistry {
  if (corpus.tenantId !== registry.tenantId) throw new Error("registerCorpus: isolamento multi-tenant violado");
  if (registry.entries.some(e => e.corpusId === corpus.id)) return registry;
  const entries = [...registry.entries, toEntry(corpus)].sort((a, b) => a.corpusId.localeCompare(b.corpusId));
  return { ...registry, entries };
}

export function findRegistryEntry(registry: CorpusRegistry, corpusId: string): CorpusRegistryEntry | null {
  return registry.entries.find(e => e.corpusId === corpusId) ?? null;
}

/** Entradas por tipo de corpus (determinístico). */
export function registryByType(registry: CorpusRegistry, type: CorpusTypeId): CorpusRegistryEntry[] {
  return registry.entries.filter(e => e.type === type);
}
