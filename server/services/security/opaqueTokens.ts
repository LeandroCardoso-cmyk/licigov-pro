/**
 * PR A.1 — Tokens opacos de uso único (convite institucional, redefinição de senha).
 *
 * O token em texto claro vive SOMENTE no e-mail enviado ao destinatário — nunca é persistido,
 * nunca é logado. O banco guarda apenas `sha256(token)`; a busca por token recebido do cliente
 * sempre passa por `hashOpaqueToken` antes da query, e a comparação vira uma busca por igualdade
 * de hash (não há necessidade de comparação em tempo constante adicional: MySQL já não expõe
 * timing de índice de forma útil a um atacante remoto, e o espaço de 256 bits torna força bruta
 * inviável de qualquer forma).
 */

import { randomBytes, createHash } from "crypto";

/** Bytes de entropia do token — 256 bits, mesmo padrão de segredos de sessão do projeto. */
const TOKEN_BYTES = 32;

/** Gera um token opaco novo (base64url, ~43 caracteres, sem padding). */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hash SHA-256 (hex, 64 chars) do token — o que é efetivamente persistido/consultado no banco. */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Checagem de formato leve, ANTES de tocar o banco — rejeita entradas obviamente inválidas
 * (string vazia, JSON, espaços, um token de outro sistema) em endpoints públicos sem gastar uma
 * query. Não é validação de segurança (isso é o hash + expiração no banco), só sanity check.
 */
const PLAUSIBLE_TOKEN_REGEX = /^[A-Za-z0-9_-]{32,128}$/;
export function isPlausibleOpaqueToken(token: unknown): token is string {
  return typeof token === "string" && PLAUSIBLE_TOKEN_REGEX.test(token);
}
