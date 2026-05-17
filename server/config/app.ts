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
};
