import crypto from "crypto";
import { APP_ENV } from "../config/env";
import { SIGNATURE_KEY_CONFIG, type SignatureKeyConfig } from "../config/signature";
import { serviceLogger } from "./observabilityService";

/**
 * Serviço de Assinatura Digital
 * Sistema simplificado de assinatura digital para validação jurídica de documentos
 */

/**
 * Gera hash SHA-256 do conteúdo do documento
 */
export function generateContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Qual chave validou a assinatura (auditoria da migração: quando `legacy_jwt_secret` desaparecer, o fallback pode sair). */
export type SignatureKeyUsed = "dedicated" | "legacy_jwt_secret";

const sigLog = serviceLogger("digitalSignatureService");
let hmacKeyWarningEmitted = false;

/**
 * R9 / SEM-083 — aviso estruturado ÚNICO (por processo): não há `SIGNATURE_HMAC_KEY`; a assinatura/verificação usa a
 * derivação legada do JWT_SECRET. Em produção/staging é registrado em nível de erro (alto) — nunca falha o fluxo.
 */
function warnHmacKeyNotConfiguredOnce(): void {
  if (hmacKeyWarningEmitted) return;
  hmacKeyWarningEmitted = true;
  const data = {
    appEnv: APP_ENV,
    hint: "Defina SIGNATURE_HMAC_KEY (chave dedicada, mín. 32 chars). Sem ela a assinatura continua atrelada ao JWT_SECRET (fallback transitório).",
  };
  if (APP_ENV === "production" || APP_ENV === "staging") sigLog.error("signature_hmac_key_not_configured", data);
  else sigLog.warn("signature_hmac_key_not_configured", data);
}

/** Só para testes: reabilita o aviso "uma vez". */
export function __resetSignatureKeyWarningForTests(): void { hmacKeyWarningEmitted = false; }

/** Chave HMAC DEDICADA (domínio separado do legado: prefixo próprio, nunca confundível com a derivação antiga). */
function dedicatedPrivateKey(userId: number, key: string): string {
  return `LICIGOV_SIGNATURE_HMAC_V2_USER_${userId}_${key}`;
}

/** Derivação LEGADA (bit a bit a anterior): `PRIVATE_KEY_USER_<id>_<JWT_SECRET cru>`. */
function legacyPrivateKey(userId: number, legacySecret: string): string {
  return `PRIVATE_KEY_USER_${userId}_${legacySecret}`;
}

const hmac = (privateKey: string, contentHash: string): string =>
  crypto.createHmac("sha256", privateKey).update(contentHash).digest("hex");

/**
 * Gera assinatura digital simulada (hash + chave privada simulada)
 * Em produção, usar certificado digital ICP-Brasil ou similar.
 *
 * R9 / SEM-083 — assina com a chave dedicada (`SIGNATURE_HMAC_KEY`, via `server/config/signature`) quando
 * configurada; sem ela cai na derivação legada do JWT_SECRET com o aviso `signature_hmac_key_not_configured`.
 */
export function generateSignature(contentHash: string, userId: number, config: SignatureKeyConfig = SIGNATURE_KEY_CONFIG): string {
  if (config.dedicatedKey) return hmac(dedicatedPrivateKey(userId, config.dedicatedKey), contentHash);
  warnHmacKeyNotConfiguredOnce();
  return hmac(legacyPrivateKey(userId, config.legacySecret), contentHash);
}

/** Comparação em tempo constante; tamanhos/hex inválidos ⇒ falso (nunca lança). */
function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Verifica a assinatura e informa QUAL chave a validou. Ordem: chave dedicada (se configurada) → derivação legada do
 * JWT_SECRET (fallback TRANSITÓRIO — mantém verificáveis as assinaturas já emitidas; não há rotação aqui).
 */
export function verifySignatureWithKeyInfo(
  contentHash: string, signature: string, userId: number, config: SignatureKeyConfig = SIGNATURE_KEY_CONFIG,
): { valid: boolean; keyUsed: SignatureKeyUsed | null } {
  if (config.dedicatedKey && safeEqualHex(signature, hmac(dedicatedPrivateKey(userId, config.dedicatedKey), contentHash))) {
    return { valid: true, keyUsed: "dedicated" };
  }
  if (!config.dedicatedKey) warnHmacKeyNotConfiguredOnce();
  if (safeEqualHex(signature, hmac(legacyPrivateKey(userId, config.legacySecret), contentHash))) {
    return { valid: true, keyUsed: "legacy_jwt_secret" };
  }
  return { valid: false, keyUsed: null };
}

/**
 * Valida assinatura digital (chave dedicada primeiro; fallback legado transitório — ver `verifySignatureWithKeyInfo`).
 */
export function validateSignature(
  contentHash: string,
  signature: string,
  userId: number,
  config: SignatureKeyConfig = SIGNATURE_KEY_CONFIG,
): boolean {
  return verifySignatureWithKeyInfo(contentHash, signature, userId, config).valid;
}

/**
 * Gera informações de certificado simulado
 */
export function generateCertificateInfo(userName: string, userEmail: string | null) {
  const now = new Date();
  const validFrom = now.toISOString();
  const validUntil = new Date(now.getFullYear() + 3, now.getMonth(), now.getDate()).toISOString();
  
  return {
    issuer: "LiciGov Pro - Sistema de Assinatura Digital",
    subject: userName,
    subjectEmail: userEmail || "não informado",
    serialNumber: crypto.randomBytes(16).toString("hex"),
    validFrom,
    validUntil,
    algorithm: "SHA-256 with HMAC",
    keySize: 256,
  };
}

/**
 * Formata assinatura para exibição em documentos
 */
export function formatSignatureBlock(signature: {
  signedByName: string;
  signedByEmail: string | null;
  signedAt: Date;
  signature: string;
  contentHash: string;
}): string {
  const date = new Date(signature.signedAt).toLocaleString("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
  });
  
  return `
---

## 🔐 Assinatura Digital

**Assinado por:** ${signature.signedByName}  
**E-mail:** ${signature.signedByEmail || "Não informado"}  
**Data/Hora:** ${date}

**Hash do Documento (SHA-256):**  
\`${signature.contentHash}\`

**Assinatura Digital:**  
\`${signature.signature.substring(0, 64)}...\`

---

*Este documento foi assinado digitalmente. A assinatura garante a autenticidade e integridade do conteúdo.*
*Qualquer alteração no documento invalidará a assinatura.*
`;
}
