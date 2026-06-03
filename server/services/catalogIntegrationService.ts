/**
 * Sprint 3.0 — Catalog Integration Service.
 *
 * Fundação operacional para integração CATMAT/CATSER. NÃO acessa API externa:
 * opera sobre catálogo semente / em memória. Normaliza entradas (PT-BR), indexa
 * em um SemanticIndex e versiona snapshots reusando catalogSynchronization.
 *
 * PRINCÍPIOS:
 *   - Indexação determinística: mesmas entradas → mesmo índice.
 *   - Updates replay-safe: snapshots versionados com checksum SHA-256.
 *   - Multi-tenant: organizationId em toda entrada (0 = catálogo global).
 *   - Cache em memória com TTL.
 *
 * Embasamento: padronização de objetos via Catálogo de Materiais/Serviços do
 * COMPRAS.GOV.BR, em apoio ao planejamento (Lei 14.133/2021, art. 18).
 */

import { tokenize } from "../domain/semanticIndex";
import { SemanticIndex, createSearchEntry } from "../domain/semanticIndex";
import { normalizeUnit } from "../domain/canonicalUnits";
import {
  createSnapshot,
  addToHistory,
  computeChecksum,
  isSnapshotStale,
  type CatalogSnapshot,
  type CatalogSyncHistory,
  type CatalogType,
} from "../domain/catalogSynchronization";

// ─── Catalog entry ────────────────────────────────────────────────────────────

export type CatalogEntryType = "catmat" | "catser";

export interface CatalogEntry {
  code:                  string;
  catalogType:           CatalogEntryType;
  description:           string;
  normalizedDescription: string;
  unit:                  string | null;
  canonicalUnit:         string | null;
  aliases:               string[];
  tokens:                string[];
  organizationId:        number; // 0 = global
  active:                boolean;
  group?:                string;
}

export interface RawCatalogEntry {
  code:        string;
  catalogType: CatalogEntryType;
  description: string;
  unit?:       string | null;
  aliases?:    string[];
  group?:      string;
  active?:     boolean;
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normaliza uma entrada bruta de catálogo: tokeniza (PT-BR), normaliza unidade
 * e deduplica/ordena tokens. Determinístico.
 */
export function normalizeCatalogEntry(
  raw:            RawCatalogEntry,
  organizationId: number,
): CatalogEntry {
  const normalizedDescription = tokenize(raw.description).join(" ");
  const aliasTokens = (raw.aliases ?? []).flatMap(a => tokenize(a));
  const tokens = Array.from(new Set([...tokenize(raw.description), ...aliasTokens])).sort();
  const unitResult = raw.unit ? normalizeUnit(raw.unit) : null;

  return {
    code:                  raw.code,
    catalogType:           raw.catalogType,
    description:           raw.description,
    normalizedDescription,
    unit:                  raw.unit ?? null,
    canonicalUnit:         unitResult?.canonical ?? null,
    aliases:               raw.aliases ? [...raw.aliases] : [],
    tokens,
    organizationId,
    active:                raw.active ?? true,
    group:                 raw.group,
  };
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

/**
 * Ingere entradas brutas, normalizando-as. Determinístico, ordenado por code.
 */
export function ingestCatalog(
  entries:        RawCatalogEntry[],
  organizationId: number,
): CatalogEntry[] {
  return entries
    .map(e => normalizeCatalogEntry(e, organizationId))
    .sort((a, b) => a.code.localeCompare(b.code));
}

// ─── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Indexa entradas de catálogo num SemanticIndex (determinístico: entradas
 * ordenadas por code antes da inserção). Cada entrada vira um SemanticSearchEntry.
 */
export function indexCatalog(
  entries: CatalogEntry[],
  index:   SemanticIndex = new SemanticIndex(),
): SemanticIndex {
  const ordered = [...entries].sort((a, b) => a.code.localeCompare(b.code));
  for (const entry of ordered) {
    if (!entry.active) continue;
    const searchEntry = createSearchEntry(entry.organizationId, entry.description, {
      aliases:    entry.aliases,
      source:     "catmat",
      catmatCode: entry.code,
      catmatGroup: entry.group,
      category:   entry.catalogType,
    });
    index.add(searchEntry);
  }
  return index;
}

// ─── Checksum of catalog ──────────────────────────────────────────────────────

/**
 * Computa checksum determinístico de um conjunto de entradas (ordenado por code).
 */
export function computeCatalogChecksum(entries: CatalogEntry[]): string {
  const canonical = [...entries]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(e => ({
      code: e.code,
      catalogType: e.catalogType,
      normalizedDescription: e.normalizedDescription,
      canonicalUnit: e.canonicalUnit,
      tokens: e.tokens,
      active: e.active,
    }));
  return computeChecksum(JSON.stringify(canonical));
}

// ─── Sync (snapshot + history) ────────────────────────────────────────────────

export interface CatalogSyncResult {
  snapshot:  CatalogSnapshot;
  history:   CatalogSyncHistory;
  checksum:  string;
}

/**
 * Sincroniza um catálogo: cria snapshot versionado e registra a operação no
 * histórico. Replay-safe — mesmas entradas/versão → mesmo checksum.
 */
export function syncCatalog(
  organizationId: number,
  catalogType:    CatalogType,
  version:        string,
  entries:        CatalogEntry[],
  params: {
    previousSnapshot?: CatalogSnapshot | null;
    actor?:            string;
    reason?:           string;
    ttlMs?:            number;
  } = {},
): CatalogSyncResult {
  const checksum = computeCatalogChecksum(entries);
  const indexed = entries.filter(e => e.active).length;
  const snapshot = createSnapshot(
    organizationId,
    catalogType,
    version,
    entries.length,
    checksum,
    {
      indexedEntries:  indexed,
      snapshotLineage: params.previousSnapshot?.id ?? null,
      ttlMs:           params.ttlMs,
    },
  );
  const history = addToHistory(
    snapshot,
    params.previousSnapshot ? "update" : "create",
    version,
    params.actor ?? "system",
    params.reason ?? `Sincronização do catálogo ${catalogType} v${version}.`,
    params.previousSnapshot?.version ?? null,
  );
  return { snapshot, history, checksum };
}

// ─── In-memory cache (TTL) ────────────────────────────────────────────────────

interface CacheRecord {
  snapshot:  CatalogSnapshot;
  entries:   CatalogEntry[];
  index:     SemanticIndex;
  cachedAt:  number; // epoch ms
  ttlMs:     number;
}

const CATALOG_CACHE = new Map<string, CacheRecord>();

function cacheKey(organizationId: number, catalogType: CatalogType): string {
  return `${organizationId}:${catalogType}`;
}

/**
 * Coloca um catálogo no cache, indexando-o. Retorna o snapshot.
 */
export function cacheCatalog(
  organizationId: number,
  catalogType:    CatalogType,
  version:        string,
  entries:        CatalogEntry[],
  ttlMs           = 24 * 60 * 60 * 1000,
): CatalogSyncResult {
  const result = syncCatalog(organizationId, catalogType, version, entries, { ttlMs });
  const index = indexCatalog(entries);
  CATALOG_CACHE.set(cacheKey(organizationId, catalogType), {
    snapshot: result.snapshot,
    entries:  [...entries],
    index,
    cachedAt: Date.now(),
    ttlMs,
  });
  return result;
}

/**
 * Recupera o snapshot em cache, se ainda válido (não expirado).
 */
export function getCatalogSnapshot(
  organizationId: number,
  catalogType:    CatalogType,
): CatalogSnapshot | null {
  const record = CATALOG_CACHE.get(cacheKey(organizationId, catalogType));
  if (!record) return null;
  if (Date.now() - record.cachedAt >= record.ttlMs) return null;
  if (isSnapshotStale(record.snapshot, record.ttlMs)) return null;
  return record.snapshot;
}

export function getCachedIndex(
  organizationId: number,
  catalogType:    CatalogType,
): SemanticIndex | null {
  const record = CATALOG_CACHE.get(cacheKey(organizationId, catalogType));
  if (!record) return null;
  if (Date.now() - record.cachedAt >= record.ttlMs) return null;
  return record.index;
}

export function getCachedEntries(
  organizationId: number,
  catalogType:    CatalogType,
): CatalogEntry[] | null {
  const record = CATALOG_CACHE.get(cacheKey(organizationId, catalogType));
  if (!record) return null;
  if (Date.now() - record.cachedAt >= record.ttlMs) return null;
  return record.entries;
}

export function clearCatalogCache(): void {
  CATALOG_CACHE.clear();
}

// ─── Seed catalog ─────────────────────────────────────────────────────────────

/**
 * Catálogo semente (subset operacional de CATMAT/CATSER) para testes e operação
 * offline. organizationId 0 = global. Códigos no padrão COMPRAS.GOV.BR.
 */
export const SEED_CATALOG: RawCatalogEntry[] = [
  // ── CATMAT (materiais) ──
  {
    code: "150001", catalogType: "catmat",
    description: "Papel A4 branco 75g resma 500 folhas",
    unit: "RESMA", group: "Material de Expediente",
    aliases: ["papel sulfite a4", "papel a4 75 gramas", "resma papel a4"],
  },
  {
    code: "150002", catalogType: "catmat",
    description: "Caneta esferográfica azul corpo transparente",
    unit: "UN", group: "Material de Expediente",
    aliases: ["caneta azul", "caneta esferografica"],
  },
  {
    code: "194567", catalogType: "catmat",
    description: "Notebook portátil 16GB RAM SSD 512GB tela 14 polegadas",
    unit: "UN", group: "Equipamentos de Informática",
    aliases: ["notebook", "laptop", "computador portatil"],
  },
  {
    code: "267890", catalogType: "catmat",
    description: "Álcool etílico hidratado 70% solução antisséptica 1 litro",
    unit: "L", group: "Material de Limpeza",
    aliases: ["alcool 70", "alcool gel", "alcool etilico"],
  },
  {
    code: "300012", catalogType: "catmat",
    description: "Cadeira giratória ergonômica com apoio de braços",
    unit: "UN", group: "Mobiliário",
    aliases: ["cadeira escritorio", "cadeira giratoria"],
  },
  // ── CATSER (serviços) ──
  {
    code: "500120", catalogType: "catser",
    description: "Serviço de limpeza e conservação predial continuada",
    unit: "MES", group: "Serviços de Apoio",
    aliases: ["limpeza predial", "servico de limpeza", "conservacao predial"],
  },
  {
    code: "500341", catalogType: "catser",
    description: "Serviço de manutenção preventiva de equipamentos de informática",
    unit: "MES", group: "Serviços de TIC",
    aliases: ["manutencao de informatica", "suporte tecnico"],
  },
  {
    code: "500789", catalogType: "catser",
    description: "Serviço de vigilância patrimonial armada",
    unit: "MES", group: "Serviços de Segurança",
    aliases: ["vigilancia armada", "seguranca patrimonial"],
  },
];

/**
 * Ingere o catálogo semente para uma organização (ou global, org=0).
 */
export function ingestSeedCatalog(organizationId = 0): CatalogEntry[] {
  return ingestCatalog(SEED_CATALOG, organizationId);
}
