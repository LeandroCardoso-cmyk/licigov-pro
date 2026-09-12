/**
 * A3-RD1 — Canonicalização e hashing determinístico da referência jurídica.
 *
 * Contrato canônico (F-LEGAL1.1 §4.2): SHA-256 / UTF-8(NFC) / canonical JSON /
 * chaves de objeto ordenadas / arrays na ordem fornecida (o chamador pré-ordena os
 * arrays de conteúdo) / sem espaços entre tokens / `null` explícito. O hash sela o
 * CONTEÚDO — campos mutáveis de lifecycle (id/status/createdAt/approval*) NUNCA entram
 * no objeto canônico. Reprodutível byte-a-byte em local/CI/staging/production.
 */
import { createHash } from "crypto";

/** Ordena chaves recursivamente e normaliza strings (NFC). Arrays preservam a ordem dada. */
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  if (typeof value === "string") return value.normalize("NFC");
  return value;
}

/** Serialização canônica (sem espaços; chaves ordenadas; null explícito). */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 hex minúsculo do conteúdo canônico. */
export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}
