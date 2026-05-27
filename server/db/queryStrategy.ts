/**
 * Sprint 1.8 — Estratégia oficial Anti N+1 do LiciGov Pro.
 *
 * Padrões obrigatórios para: paginação, batching, eager loading.
 * Todo repository que retorna listas DEVE usar estas abstrações.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE     = 100;

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  page?:     number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items:           T[];
  total:           number;
  page:            number;
  pageSize:        number;
  totalPages:      number;
  hasNextPage:     boolean;
  hasPreviousPage: boolean;
}

/**
 * Normaliza parâmetros de paginação para valores seguros.
 * page: mínimo 1 | pageSize: entre 1 e MAX_PAGE_SIZE
 */
export function normalizePagination(
  params: PaginationParams,
): Required<PaginationParams> {
  const page     = Math.max(1, Math.floor(params.page     ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page, pageSize };
}

/**
 * Calcula o offset SQL a partir dos parâmetros normalizados.
 */
export function calculateOffset(
  { page, pageSize }: Required<PaginationParams>,
): number {
  return (page - 1) * pageSize;
}

/**
 * Monta o resultado paginado padrão a partir de items + total.
 */
export function buildPaginatedResult<T>(
  items:    T[],
  total:    number,
  params:   Required<PaginationParams>,
): PaginatedResult<T> {
  const { page, pageSize } = params;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage:     page < totalPages,
    hasPreviousPage: page > 1,
  };
}

// ─── Relation Loading ─────────────────────────────────────────────────────────

export type RelationStrategy = "eager" | "lazy" | "none";

export interface RelationPolicy {
  strategy:   RelationStrategy;
  maxDepth?:  number;
  batchSize?: number;
}

// ─── DataLoader-style Batching ────────────────────────────────────────────────

/**
 * Carrega entidades por IDs em batch (evita N+1 queries).
 * Deduplica IDs automaticamente. Retorna Map<id, item>.
 *
 * Uso: ao carregar relações 1-para-1 (ex: users por userId).
 */
export async function batchByIds<T>(
  ids:    number[],
  loadFn: (ids: number[]) => Promise<T[]>,
  keyFn:  (item: T) => number,
): Promise<Map<number, T>> {
  if (ids.length === 0) return new Map();
  const uniqueIds = [...new Set(ids)];
  const items     = await loadFn(uniqueIds);
  return new Map(items.map(item => [keyFn(item), item]));
}

/**
 * Carrega relações 1-para-N em batch (evita N+1 queries).
 * Retorna Map<key, item[]> — cada chave pode ter múltiplos items.
 *
 * Uso: ao carregar relações 1-para-N (ex: comments por processId).
 */
export async function batchByKey<K extends string | number, T>(
  keys:   K[],
  loadFn: (keys: K[]) => Promise<T[]>,
  keyFn:  (item: T) => K,
): Promise<Map<K, T[]>> {
  if (keys.length === 0) return new Map();
  const uniqueKeys = [...new Set(keys)];
  const items      = await loadFn(uniqueKeys);
  const result     = new Map<K, T[]>();
  for (const item of items) {
    const k      = keyFn(item);
    const bucket = result.get(k) ?? [];
    bucket.push(item);
    result.set(k, bucket);
  }
  return result;
}
