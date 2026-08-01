import { IS_PRODUCTION, IS_STAGING } from "./env";

/**
 * SEC-036 — Content-Security-Policy centralizada, explícita e testável.
 *
 * Substitui a CSP *default* implícita do Helmet (`contentSecurityPolicy: undefined`) por uma
 * política declarada aqui, para que seja:
 *   - **restritiva por padrão** (`script-src 'self'`, sem `'unsafe-inline'` global em scripts);
 *   - **determinística e testável** (o header não depende de defaults internos do Helmet);
 *   - **capaz de liberar apenas os domínios estritamente necessários** (analítica), sem wildcard
 *     amplo e desligada por padrão.
 *
 * Regras de decisão:
 *   - `cspEnabled`: em produção/staging fica LIGADA por padrão (desliga só com
 *     `HELMET_CSP_ENABLED=false`); em dev fica desligada (o Vite injeta scripts inline no HMR).
 *   - `allowAnalytics`: libera os domínios do Google (GA4) SOMENTE quando `CSP_ALLOW_ANALYTICS=true`.
 *     Deve andar junto com `VITE_GA_MEASUREMENT_ID` no build do cliente. Em staging/dev fica
 *     desligada → landing e login sem violação, com a CSP mantida restritiva.
 */

/** Domínios EXATOS do Google Analytics GA4 (sem wildcard amplo). */
export const ANALYTICS_SCRIPT_SRC = ["https://www.googletagmanager.com"] as const;
export const ANALYTICS_CONNECT_SRC = [
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
  "https://region1.google-analytics.com",
] as const;
export const ANALYTICS_IMG_SRC = [
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
] as const;

export function isCspEnabled(): boolean {
  return IS_PRODUCTION || IS_STAGING
    ? process.env.HELMET_CSP_ENABLED !== "false"
    : process.env.HELMET_CSP_ENABLED === "true";
}

export function isAnalyticsAllowed(): boolean {
  return process.env.CSP_ALLOW_ANALYTICS === "true";
}

export type CspDirectives = Record<string, string[]>;

/**
 * Monta as diretivas da CSP. `allowAnalytics` é injetável para testes; por padrão lê o ambiente.
 */
export function buildCspDirectives(allowAnalytics: boolean = isAnalyticsAllowed()): CspDirectives {
  const analyticsScript = allowAnalytics ? [...ANALYTICS_SCRIPT_SRC] : [];
  const analyticsConnect = allowAnalytics ? [...ANALYTICS_CONNECT_SRC] : [];
  const analyticsImg = allowAnalytics ? [...ANALYTICS_IMG_SRC] : [];

  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    fontSrc: ["'self'", "https:", "data:"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],
    // Downloads/anexos vêm da API tRPC (same-origin) e viram blob:; nada de S3 direto no browser.
    imgSrc: ["'self'", "data:", "blob:", ...analyticsImg],
    objectSrc: ["'none'"],
    // NUNCA 'unsafe-inline' aqui — o shell não tem mais script inline (tema externalizado; GA em runtime).
    scriptSrc: ["'self'", ...analyticsScript],
    scriptSrcAttr: ["'none'"],
    // 'unsafe-inline' vale só para ESTILOS (Recharts injeta <style>; TipTap usa style inline) —
    // não afeta a segurança de scripts. Espelha o default do Helmet para style-src.
    styleSrc: ["'self'", "https:", "'unsafe-inline'"],
    connectSrc: ["'self'", ...analyticsConnect],
    upgradeInsecureRequests: [],
  };
}

/**
 * Opção pronta para `helmet({ contentSecurityPolicy: buildHelmetContentSecurityPolicy() })`.
 * Retorna `false` quando a CSP está desligada (dev por padrão), ou o objeto de diretivas.
 */
export function buildHelmetContentSecurityPolicy():
  | false
  | { useDefaults: false; directives: CspDirectives } {
  if (!isCspEnabled()) return false;
  return { useDefaults: false, directives: buildCspDirectives() };
}
