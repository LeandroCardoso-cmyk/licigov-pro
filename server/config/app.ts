import { APP_ENV, IS_DEVELOPMENT, IS_PRODUCTION, IS_STAGING, ENV_TAG } from "./env";

export const APP_CONFIG = {
  name: "LiciGov Pro",
  version: process.env.npm_package_version ?? "1.0.0",
  env: APP_ENV,
  isProduction: IS_PRODUCTION,
  isStaging: IS_STAGING,
  isDevelopment: IS_DEVELOPMENT,
  /** Prefixo de log: [BOOT][staging] etc. */
  tag: ENV_TAG,
  port: parseInt(process.env.PORT ?? "3000"),
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  /**
   * SEC-036 — Content-Security-Policy do Helmet. **Secure-by-default**: em produção/staging a CSP
   * padrão do Helmet fica **LIGADA por padrão**; só é desligada com `HELMET_CSP_ENABLED=false`
   * (escape hatch operacional explícito). Em desenvolvimento fica desligada (o Vite injeta scripts
   * inline). Ação operacional: validar em staging que a CSP padrão não quebra assets do SPA; se
   * quebrar, ajustar as diretivas — nunca desligar em produção sem substituto.
   */
  cspEnabled: (IS_PRODUCTION || IS_STAGING)
    ? process.env.HELMET_CSP_ENABLED !== "false"
    : process.env.HELMET_CSP_ENABLED === "true",
};
