import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

/**
 * Router para integração com CATMAT/CATSER (Catálogo de Materiais e Serviços do Governo Federal)
 * API pública do ComprasNet: https://dadosabertos.compras.gov.br
 */

const BASE_URL = "https://dadosabertos.compras.gov.br";

// Cache simples em memória (pode ser substituído por Redis no futuro)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

function getCachedData(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCachedData(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

export const catmatRouter = router({
  /**
   * Busca materiais no CATMAT por termo de busca
   */
  searchMaterials: publicProcedure
    .input(
      z.object({
        searchTerm: z.string().min(2, "Digite pelo menos 2 caracteres"),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `materials:${input.searchTerm}:${input.page}:${input.pageSize}`;
      
      // Verificar cache
      const cachedData = getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      try {
        const url = new URL(`${BASE_URL}/modulo-material/4_consultarItemMaterial`);
        url.searchParams.append("descricaoItem", input.searchTerm);
        url.searchParams.append("pagina", input.page.toString());
        url.searchParams.append("tamanhoPagina", input.pageSize.toString());
        url.searchParams.append("statusItem", "true"); // Apenas itens ativos

        const response = await fetch(url.toString(), {
          headers: {
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`API retornou status ${response.status}`);
        }

        const data = await response.json();
        
        // Armazenar em cache
        setCachedData(cacheKey, data);

        return data;
      } catch (error: any) {
        console.error("[CATMAT] Erro ao buscar materiais:", error);
        throw new Error("Erro ao buscar materiais no CATMAT. Tente novamente.");
      }
    }),

  /**
   * Busca serviços no CATSER por termo de busca
   */
  searchServices: publicProcedure
    .input(
      z.object({
        searchTerm: z.string().min(2, "Digite pelo menos 2 caracteres"),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `services:${input.searchTerm}:${input.page}:${input.pageSize}`;
      
      // Verificar cache
      const cachedData = getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      try {
        const url = new URL(`${BASE_URL}/modulo-servico/6_consultarItemServico`);
        url.searchParams.append("descricaoItem", input.searchTerm);
        url.searchParams.append("pagina", input.page.toString());
        url.searchParams.append("tamanhoPagina", input.pageSize.toString());
        url.searchParams.append("statusItem", "true"); // Apenas itens ativos

        const response = await fetch(url.toString(), {
          headers: {
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`API retornou status ${response.status}`);
        }

        const data = await response.json();
        
        // Armazenar em cache
        setCachedData(cacheKey, data);

        return data;
      } catch (error: any) {
        console.error("[CATSER] Erro ao buscar serviços:", error);
        throw new Error("Erro ao buscar serviços no CATSER. Tente novamente.");
      }
    }),

  /**
   * Busca item específico do CATMAT por código
   */
  getMaterialByCode: publicProcedure
    .input(
      z.object({
        code: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `material:${input.code}`;
      
      // Verificar cache
      const cachedData = getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      try {
        const url = new URL(`${BASE_URL}/modulo-material/4_consultarItemMaterial`);
        url.searchParams.append("codigoItem", input.code.toString());

        const response = await fetch(url.toString(), {
          headers: {
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`API retornou status ${response.status}`);
        }

        const data = await response.json();
        
        // Armazenar em cache
        setCachedData(cacheKey, data);

        return data.data?.[0] || null;
      } catch (error: any) {
        console.error("[CATMAT] Erro ao buscar material por código:", error);
        throw new Error("Erro ao buscar material no CATMAT. Tente novamente.");
      }
    }),

  /**
   * Busca item específico do CATSER por código
   */
  getServiceByCode: publicProcedure
    .input(
      z.object({
        code: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `service:${input.code}`;
      
      // Verificar cache
      const cachedData = getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      try {
        const url = new URL(`${BASE_URL}/modulo-servico/6_consultarItemServico`);
        url.searchParams.append("codigoItem", input.code.toString());

        const response = await fetch(url.toString(), {
          headers: {
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`API retornou status ${response.status}`);
        }

        const data = await response.json();
        
        // Armazenar em cache
        setCachedData(cacheKey, data);

        return data.data?.[0] || null;
      } catch (error: any) {
        console.error("[CATSER] Erro ao buscar serviço por código:", error);
        throw new Error("Erro ao buscar serviço no CATSER. Tente novamente.");
      }
    }),
});
