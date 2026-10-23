import { z } from "zod";
import { tenantProcedure, router } from "../_core/trpc";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { buildCatalogParams, fetchOfficialCatalogRaw } from "../services/officialCatalogService";
import { searchCatalogIndex } from "../services/itemCatalogClassificationService";
import type { OfficialCatalogType } from "../domain/officialCatalog";

/**
 * Router para integração com CATMAT/CATSER (Catálogo de Materiais e Serviços do Governo Federal)
 * API pública do ComprasNet: https://dadosabertos.compras.gov.br
 *
 * O transporte HTTP (endereço-base, timeout, erro classificado) é o MESMO do fluxo dos Itens Inteligentes
 * (`services/officialCatalogService.ts`); este router mantém o retorno bruto histórico da busca pública.
 */

// Cache simples em memória (pode ser substituído por Redis no futuro)
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

function getCachedData(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCachedData(key: string, data: unknown) {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Retorno BRUTO da fonte (contrato histórico da busca pública — o cliente legado lê o envelope diretamente).
 * O fluxo governado dos Itens Inteligentes NÃO usa este retorno: usa o parser tolerante de `domain/officialCatalog`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload externo bruto, repassado como antes
type RawCatalogPayload = any;

async function fetchCatalog(type: OfficialCatalogType, params: Record<string, string>, errorMessage: string): Promise<RawCatalogPayload> {
  const res = await fetchOfficialCatalogRaw(type, params);
  if (!res.ok) {
    console.error(`[${type.toUpperCase()}] Consulta indisponível (${res.reason}): ${res.detail}`);
    throw new Error(errorMessage);
  }
  return res.json;
}

/** Primeira linha do envelope (`resultado` na API atual; `data` mantido por compatibilidade). */
function firstRow(data: unknown): RawCatalogPayload {
  const env = data && typeof data === "object" ? (data as { resultado?: unknown; data?: unknown }) : null;
  const rows = env?.resultado ?? env?.data;
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

const searchInput = z.object({
  searchTerm: z.string().min(2, "Digite pelo menos 2 caracteres"),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(50).default(10),
});

export const catmatRouter = router({
  /**
   * Busca materiais no CATMAT por termo de busca
   */
  searchMaterials: tenantProcedure.use(rateLimitMiddleware("catmat"))
    .input(searchInput)
    .query(async ({ input }) => {
      const cacheKey = `materials:${input.searchTerm}:${input.page}:${input.pageSize}`;
      const cachedData = getCachedData(cacheKey);
      if (cachedData) return cachedData;
      const data = await fetchCatalog("catmat", buildCatalogParams("catmat", {
        term: input.searchTerm, page: input.page, pageSize: input.pageSize, activeOnly: true,
      }), "Erro ao buscar materiais no CATMAT. Tente novamente.");
      setCachedData(cacheKey, data);
      return data;
    }),

  /**
   * Busca serviços no CATSER por termo de busca
   */
  searchServices: tenantProcedure.use(rateLimitMiddleware("catmat"))
    .input(searchInput)
    .query(async ({ input }) => {
      const cacheKey = `services:${input.searchTerm}:${input.page}:${input.pageSize}`;
      const cachedData = getCachedData(cacheKey);
      if (cachedData) return cachedData;
      // A API do CATSER não tem filtro textual: busca no índice sincronizado (envelope no formato da fonte).
      const idx = await searchCatalogIndex("catser", input.searchTerm, input.pageSize);
      if (idx.status === "index_unavailable") throw new Error("Busca de serviços indisponível: o índice do CATSER ainda não foi sincronizado. Informe o código.");
      const data: RawCatalogPayload = {
        resultado: idx.results.map((r) => ({ codigoServico: Number(r.entry.code), nomeServico: r.entry.description, statusServico: true })),
        totalRegistros: idx.results.length, fonte: "indice-sincronizado", indiceAtualizadoEm: idx.index.retrievedAt,
      };
      setCachedData(cacheKey, data);
      return data;
    }),

  /**
   * Busca item específico do CATMAT por código
   */
  getMaterialByCode: tenantProcedure.use(rateLimitMiddleware("catmat"))
    .input(z.object({ code: z.number().int().positive() }))
    .query(async ({ input }) => {
      const cacheKey = `material:${input.code}`;
      const cachedData = getCachedData(cacheKey);
      if (cachedData) return firstRow(cachedData);
      const data = await fetchCatalog("catmat", buildCatalogParams("catmat", { code: input.code.toString() }), "Erro ao buscar material no CATMAT. Tente novamente.");
      setCachedData(cacheKey, data);
      return firstRow(data);
    }),

  /**
   * Busca item específico do CATSER por código
   */
  getServiceByCode: tenantProcedure.use(rateLimitMiddleware("catmat"))
    .input(z.object({ code: z.number().int().positive() }))
    .query(async ({ input }) => {
      const cacheKey = `service:${input.code}`;
      const cachedData = getCachedData(cacheKey);
      if (cachedData) return firstRow(cachedData);
      const data = await fetchCatalog("catser", buildCatalogParams("catser", { code: input.code.toString() }), "Erro ao buscar serviço no CATSER. Tente novamente.");
      setCachedData(cacheKey, data);
      return firstRow(data);
    }),
});
