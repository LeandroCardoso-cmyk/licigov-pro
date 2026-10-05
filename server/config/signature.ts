/**
 * R9 / SEM-083 — Configuração da chave HMAC da assinatura digital (config/signature.ts).
 *
 * Antes, `digitalSignatureService` derivava a chave direto de `process.env.JWT_SECRET` (violando a regra "config só via
 * server/config/*") e atrelava a validade das assinaturas ao segredo da SESSÃO: girar o JWT_SECRET invalidaria toda
 * assinatura já emitida. Agora existe uma chave PRÓPRIA, opcional:
 *
 *   SIGNATURE_HMAC_KEY  — chave HMAC dedicada da assinatura (≥ 32 caracteres; gerar:
 *                         node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").
 *
 *  - ASSINAR usa a chave dedicada quando configurada; sem ela, usa a derivação LEGADA (JWT_SECRET) — comportamento
 *    anterior preservado, mas com o aviso estruturado `signature_hmac_key_not_configured` (uma vez por processo);
 *  - VERIFICAR aceita a chave dedicada PRIMEIRO e a derivação legada como FALLBACK TRANSITÓRIO documentado, para que as
 *    assinaturas já emitidas continuem verificáveis. Quando o dono migrar/rotacionar a chave (decisão do dono — NÃO é
 *    feita aqui; nenhuma rotação é executada), o fallback é removido num passo próprio.
 *  - Produção sem a chave dedicada NÃO falha (a assinatura continua funcionando): apenas registra em nível de erro.
 *  - Chave configurada porém curta (< 32) falha no boot (config inválida, não "ausente").
 *
 * A derivação LEGADA reproduz bit a bit a anterior (`PRIVATE_KEY_USER_<id>_<JWT_SECRET cru>`), inclusive o valor
 * cru/sem trim de `process.env.JWT_SECRET` (a leitura é feita aqui, no módulo de config).
 */

export interface SignatureEnv {
  SIGNATURE_HMAC_KEY?: string;
  JWT_SECRET?: string;
}

export interface SignatureKeyConfig {
  /** Chave dedicada (já validada) ou `null` quando não configurada. */
  readonly dedicatedKey: string | null;
  /** Segredo LEGADO (JWT_SECRET cru, como a versão anterior o lia). Fallback transitório de verificação. */
  readonly legacySecret: string;
}

export const MIN_SIGNATURE_HMAC_KEY_LENGTH = 32;

/** Resolução pura (testável): valida a chave dedicada e captura o segredo legado cru. */
export function resolveSignatureKeyConfig(env: SignatureEnv): SignatureKeyConfig {
  const raw = env.SIGNATURE_HMAC_KEY?.trim();
  if (raw && raw.length < MIN_SIGNATURE_HMAC_KEY_LENGTH) {
    throw new Error(
      `[BOOT] SIGNATURE_HMAC_KEY inválida: mínimo ${MIN_SIGNATURE_HMAC_KEY_LENGTH} caracteres. ` +
        `Defina uma chave longa e aleatória ou remova a variável (a derivação legada continua valendo).`
    );
  }
  // `String(undefined)` === "undefined": é exatamente o que o template literal anterior produzia sem JWT_SECRET.
  return { dedicatedKey: raw || null, legacySecret: String(env.JWT_SECRET) };
}

export const SIGNATURE_KEY_CONFIG: SignatureKeyConfig = resolveSignatureKeyConfig({
  SIGNATURE_HMAC_KEY: process.env.SIGNATURE_HMAC_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
});
