/**
 * LiciGov Pro — carregamento condicional do Google Analytics (GA4).
 *
 * SEC-036 — Antes, o GA era injetado inline em `client/index.html` e carregava em TODA rota
 * (landing, login e sistema autenticado) e em TODO ambiente (inclusive staging). Isso violava a
 * CSP `script-src 'self'` e vazava uso interno para o Google.
 *
 * Agora o GA só é carregado quando `VITE_GA_MEASUREMENT_ID` está definido no build. Assim:
 *   - staging/dev (variável ausente) → GA desligado → nenhuma requisição a googletagmanager →
 *     landing e login sem violação de CSP, com a CSP mantida restritiva;
 *   - produção (variável definida) → GA ligado, e a CSP do servidor libera apenas os domínios
 *     estritamente necessários do Google (ver server/config/csp.ts, gate `CSP_ALLOW_ANALYTICS`).
 *
 * O ID nunca é hardcodado — vem sempre do ambiente de build.
 */

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

/** Domínio único e exato do loader do GA4 (sem wildcard). */
const GTAG_ORIGIN = "https://www.googletagmanager.com";

let initialized = false;

/**
 * Inicializa o GA4 de forma idempotente. No-op quando:
 *   - não há `VITE_GA_MEASUREMENT_ID` (staging/dev/qualquer build sem analítica);
 *   - não há ambiente de browser (SSR/testes);
 *   - já foi inicializado nesta sessão.
 */
export function initAnalytics(): void {
  if (initialized) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const id = (MEASUREMENT_ID ?? "").trim();
  if (!id) return; // analítica desabilitada — caminho padrão em staging/dev

  initialized = true;

  const loader = document.createElement("script");
  loader.async = true;
  loader.src = `${GTAG_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(loader);

  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  function gtag(...args: unknown[]) {
    w.dataLayer!.push(args);
  }
  gtag("js", new Date());
  gtag("config", id);
}

/** Exposto para testes: indica se a analítica está habilitada neste build. */
export function isAnalyticsEnabled(): boolean {
  return !!(MEASUREMENT_ID ?? "").trim();
}
