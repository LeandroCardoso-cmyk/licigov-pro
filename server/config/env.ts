/**
 * Ponto único de leitura e validação de variáveis de ambiente.
 * Toda leitura de process.env deve passar por este módulo.
 */

export type AppEnv = "development" | "staging" | "production";

const VALID_ENVS: AppEnv[] = ["development", "staging", "production"];

function resolveAppEnv(): AppEnv {
  // APP_ENV tem precedência sobre NODE_ENV
  const raw = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (!VALID_ENVS.includes(raw as AppEnv)) {
    throw new Error(
      `[BOOT] APP_ENV inválido: "${raw}". Use: development | staging | production`
    );
  }
  return raw as AppEnv;
}

export const APP_ENV: AppEnv = resolveAppEnv();
export const IS_PRODUCTION = APP_ENV === "production";
export const IS_STAGING = APP_ENV === "staging";
export const IS_DEVELOPMENT = APP_ENV === "development";

/** Prefixo de log para todos os módulos (ex: [staging] [DB]) */
export const ENV_TAG = `[${APP_ENV}]`;

/**
 * Valida variáveis obrigatórias no momento do bootstrap.
 * Lança erro descritivo com todas as variáveis faltantes de uma vez.
 */
export function validateRequiredEnv(): void {
  const required: Array<{ key: string; hint: string; condition?: boolean }> = [
    { key: "DATABASE_URL",   hint: "connection string MySQL (ex: mysql://user:pass@host/db)" },
    { key: "JWT_SECRET",     hint: "segredo JWT — mínimo 32 caracteres" },
    { key: "GEMINI_API_KEY", hint: "chave da API Google Gemini para geração de documentos" },
  ];

  const missing = required
    .filter(({ condition = true }) => condition)
    .filter(({ key }) => !process.env[key]?.trim());

  if (missing.length > 0) {
    const lines = missing.map(({ key, hint }) => `  • ${key}  →  ${hint}`).join("\n");
    throw new Error(
      `[BOOT]${ENV_TAG} Variáveis de ambiente obrigatórias não definidas:\n${lines}`
    );
  }

  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) {
    throw new Error(
      `[BOOT]${ENV_TAG} JWT_SECRET deve ter no mínimo 32 caracteres (atual: ${jwtSecret.length})`
    );
  }
}
