/**
 * Ponto único de leitura e validação de variáveis de ambiente.
 * Toda leitura de process.env deve passar por este módulo.
 */

import { resolveAiRuntime, requiredCredentialEnvForProvider } from "./ai";

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
/** Variáveis obrigatórias para PRODUÇÃO (validação explícita, sem fallback silencioso). */
export const PRODUCTION_REQUIRED_ENV: ReadonlyArray<{ key: string; hint: string; productionOnly: boolean }> = [
  { key: "DATABASE_URL",          hint: "connection string MySQL (ex: mysql://user:pass@host/db)", productionOnly: false },
  { key: "JWT_SECRET",            hint: "segredo JWT — mínimo 32 caracteres", productionOnly: false },
  { key: "AWS_ACCESS_KEY_ID",     hint: "credencial AWS S3 (Storage Service)", productionOnly: true },
  { key: "AWS_SECRET_ACCESS_KEY", hint: "credencial AWS S3 (Storage Service)", productionOnly: true },
  { key: "AWS_S3_REGION",         hint: "região do bucket S3", productionOnly: true },
  { key: "AWS_S3_BUCKET",         hint: "nome do bucket S3", productionOnly: true },
  // ISSUE #159 — A credencial de IA NÃO é uma chave hardcoded aqui: a obrigatoriedade real é do
  // provider ATIVO e é validada em validateRequiredEnv() (requiredCredentialEnvForProvider). Este
  // catálogo de diagnóstico foca na infraestrutura (DB/JWT/AWS/e-mail); a credencial do provider
  // ativo é exigida no boot conforme AI_PROVIDER, não listada duplicada aqui.
  // PR A.1 — e-mail institucional (convites/recuperação de senha). A validação fail-closed
  // real (staging E production) mora em config/email.ts; estas entradas existem para que o
  // diagnóstico (environmentDiagnostic/productionReadinessReport) também as reflita.
  { key: "BREVO_API_KEY",         hint: "chave de API do Brevo (e-mail transacional)", productionOnly: true },
  { key: "BREVO_SENDER_EMAIL",    hint: "remetente autenticado no painel Brevo", productionOnly: true },
  { key: "APP_BASE_URL",          hint: "origem pública usada nos links de e-mail (convite/redefinição de senha)", productionOnly: true },
];

export function validateRequiredEnv(): void {
  // ISSUE #159 — Contrato semântico: exigimos a credencial do provider de IA ATIVO (não uma
  // chave hardcoded). Default AI_PROVIDER=gemini → GEMINI_API_KEY; claude → ANTHROPIC_API_KEY;
  // openai → OPENAI_API_KEY. Credenciais de providers NÃO ativos não bloqueiam o boot. Assim a
  // validação (obrigatória) e o diagnóstico (que não hardcoda Gemini) deixam de divergir.
  const activeProvider = resolveAiRuntime({
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
  }).provider;
  const providerCredentialKey = requiredCredentialEnvForProvider(activeProvider);

  const required: Array<{ key: string; hint: string; condition?: boolean }> = [
    { key: "DATABASE_URL",   hint: "connection string MySQL (ex: mysql://user:pass@host/db)" },
    { key: "JWT_SECRET",     hint: "segredo JWT — mínimo 32 caracteres" },
    { key: providerCredentialKey, hint: `credencial do provider de IA ativo (${activeProvider}) para geração de documentos` },
    // RC-4.2.1 — Storage/AWS obrigatório APENAS em produção (nunca fallback silencioso).
    { key: "AWS_ACCESS_KEY_ID",     hint: "credencial AWS S3 (Storage Service)", condition: IS_PRODUCTION },
    { key: "AWS_SECRET_ACCESS_KEY", hint: "credencial AWS S3 (Storage Service)", condition: IS_PRODUCTION },
    { key: "AWS_S3_REGION",         hint: "região do bucket S3", condition: IS_PRODUCTION },
    { key: "AWS_S3_BUCKET",         hint: "nome do bucket S3", condition: IS_PRODUCTION },
    // PR A.1 — e-mail institucional; enforcement fail-closed completo (staging+production) em config/email.ts.
    { key: "BREVO_API_KEY",         hint: "chave de API do Brevo (e-mail transacional)", condition: IS_PRODUCTION },
    { key: "BREVO_SENDER_EMAIL",    hint: "remetente autenticado no painel Brevo", condition: IS_PRODUCTION },
    { key: "APP_BASE_URL",          hint: "origem pública usada nos links de e-mail (convite/redefinição de senha)", condition: IS_PRODUCTION },
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

export interface EnvVarDiagnostic {
  readonly key: string;
  readonly present: boolean;
  readonly productionOnly: boolean;
  /** Obrigatória no ambiente ATUAL. */
  readonly requiredNow: boolean;
}

/** Diagnóstico (somente leitura) das variáveis de ambiente — sem lançar. */
export function environmentDiagnostic(): { env: AppEnv; vars: EnvVarDiagnostic[]; ok: boolean } {
  const vars: EnvVarDiagnostic[] = PRODUCTION_REQUIRED_ENV.map(v => {
    const requiredNow = v.productionOnly ? IS_PRODUCTION : true;
    return { key: v.key, present: Boolean(process.env[v.key]?.trim()), productionOnly: v.productionOnly, requiredNow };
  });
  const ok = vars.every(v => !v.requiredNow || v.present);
  return { env: APP_ENV, vars, ok };
}
