/**
 * Catálogo oficial CATMAT/CATSER (Compras.gov.br — Dados Abertos). Mesmo padrão de `config/ocr.ts`: resolução pura e
 * testável a partir do ambiente. Nenhuma variável é segredo (API pública, sem autenticação).
 *
 * ENV (todas opcionais):
 *   CATALOG_OFFICIAL_ENABLED     = true | false  (default: true; false na suíte de testes — os testes injetam o fetch)
 *   CATALOG_OFFICIAL_BASE_URL    = endereço-base (default https://dadosabertos.compras.gov.br)
 *   CATALOG_OFFICIAL_TIMEOUT_MS  = tempo máximo por consulta, em ms (default 8000, 1000..30000)
 *   CATALOG_OFFICIAL_CACHE_TTL_MS = validade do cache em memória de respostas válidas (default 3600000, 0..86400000)
 *
 * Desligado (`false`) ou indisponível ⇒ a consulta devolve "indisponível": nada é fabricado e a classificação fica pendente.
 */

export interface CatalogConfigEnv {
  CATALOG_OFFICIAL_ENABLED?: string;
  CATALOG_OFFICIAL_BASE_URL?: string;
  CATALOG_OFFICIAL_TIMEOUT_MS?: string;
  CATALOG_OFFICIAL_CACHE_TTL_MS?: string;
}

export interface CatalogConfig {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  cacheTtlMs: number;
}

export const DEFAULT_CATALOG_BASE_URL = "https://dadosabertos.compras.gov.br";

function intIn(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw ? parseInt(raw.trim(), 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function resolveCatalogConfig(env: CatalogConfigEnv, ctx: { isTest: boolean }): CatalogConfig {
  const rawEnabled = (env.CATALOG_OFFICIAL_ENABLED ?? "").trim().toLowerCase();
  const enabled = rawEnabled === "true" ? true : rawEnabled === "false" ? false : !ctx.isTest;
  const baseUrl = (env.CATALOG_OFFICIAL_BASE_URL ?? "").trim().replace(/\/+$/, "") || DEFAULT_CATALOG_BASE_URL;
  return {
    enabled,
    baseUrl,
    timeoutMs: intIn(env.CATALOG_OFFICIAL_TIMEOUT_MS, 8_000, 1_000, 30_000),
    cacheTtlMs: intIn(env.CATALOG_OFFICIAL_CACHE_TTL_MS, 3_600_000, 0, 86_400_000),
  };
}

export const CATALOG_CONFIG: CatalogConfig = resolveCatalogConfig(
  {
    CATALOG_OFFICIAL_ENABLED: process.env.CATALOG_OFFICIAL_ENABLED,
    CATALOG_OFFICIAL_BASE_URL: process.env.CATALOG_OFFICIAL_BASE_URL,
    CATALOG_OFFICIAL_TIMEOUT_MS: process.env.CATALOG_OFFICIAL_TIMEOUT_MS,
    CATALOG_OFFICIAL_CACHE_TTL_MS: process.env.CATALOG_OFFICIAL_CACHE_TTL_MS,
  },
  { isTest: process.env.VITEST === "true" },
);
