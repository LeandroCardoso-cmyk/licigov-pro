/**
 * Hash semântico versionado (INV-TPL-19, regra `tpl-hash/1` do T1_DESIGN_PACKAGE).
 *
 * JSON canônico: reusa `canonicalJson` (chaves ordenadas, sem espaços, `undefined` omitido, números finitos).
 * `tpl-hash/1` acrescenta, sem alterar a função compartilhada: strings em NFC e `-0` normalizado para `0`.
 * Nenhum relógio, UUID ou valor aleatório entra no hash — quem chama passa só conteúdo semântico.
 */
import { canonicalJson, sha256Hex, type CanonicalValue } from "../canonicalJson";
import { TEMPLATE_HASH_VERSION, type HashVersion, type Sha256 } from "./types";

/** Normalização `tpl-hash/1`: NFC em strings (valores e chaves), `-0` → `0`; arrays mantêm a ordem. */
export function normalizeForTemplateHash(value: unknown): CanonicalValue {
  if (value === null) return null;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => normalizeForTemplateHash(v));
  if (typeof value === "object") {
    const out: { [k: string]: CanonicalValue | undefined } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k.normalize("NFC")] = normalizeForTemplateHash(v);
    }
    return out;
  }
  throw new Error(`tpl-hash/1: tipo não serializável (${typeof value})`);
}

export function templateCanonicalJson(value: unknown): string {
  return canonicalJson(normalizeForTemplateHash(value));
}

export function templateHash(value: unknown): Sha256 {
  return sha256Hex(templateCanonicalJson(value));
}

/** `semanticHash = sha256(canonicalJSON({ hashVersion, ast, variableCatalogVersion }))`. */
export function revisionSemanticHash(input: {
  readonly ast: unknown;
  readonly variableCatalogVersion: string;
  readonly hashVersion?: HashVersion;
}): Sha256 {
  return templateHash({
    hashVersion: input.hashVersion ?? TEMPLATE_HASH_VERSION,
    ast: input.ast,
    variableCatalogVersion: input.variableCatalogVersion,
  });
}
