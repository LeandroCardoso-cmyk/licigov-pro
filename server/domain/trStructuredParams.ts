/**
 * PARÂMETROS ESTRUTURADOS DO TR (CONTEXT_REUSE 2.0) — a camada estruturada do MESMO fluxo do TR.
 *
 * O TR continua sendo um documento (texto) gerado/importado/editado/aprovado/emitido como antes. Esta camada acrescenta FATOS tipados
 * (prazo de execução, local de entrega, forma de pagamento, garantias, qualificação, vigência…) ao Contexto Canônico da Contratação
 * (`procurement_context_facts`, caminho `tr.param.<variável>`; fonte `tr`, ator humano, status `confirmed`, proveniência explícita e
 * append-only). O TR (rascunho) e o Edital consomem OS MESMOS fatos. IA nunca afirma um parâmetro.
 *
 * Puro e determinístico (sem I/O). O valor é o JSON canônico do valor TIPADO, normalizado pelo catálogo (nunca "consertado").
 */
import { createHash } from "crypto";
import {
  factValueHash, isTrParamPath, resolveField, type CanonicalField, type FactAssertion, type TrParamPath,
} from "./canonicalProcurementContext";
import { templateCanonicalJson } from "./institutionalTemplates/semanticHash";
import { normalizeValue2 } from "./institutionalTemplates/valueTypes2";
import type { VariableDef2 } from "./institutionalTemplates/variableCatalog2";

export const TR_PARAMS_VERSION = "tr-structured-params/1";
export const TR_PARAM_PREFIX = "tr.param.";

export const trParamPath = (variableName: string): TrParamPath => `${TR_PARAM_PREFIX}${variableName}` as TrParamPath;
export const variableOfTrParamPath = (path: string): string | null => (isTrParamPath(path) ? path.slice(TR_PARAM_PREFIX.length) : null);

export type EncodeResult = { readonly ok: true; readonly encoded: string; readonly value: unknown } | { readonly ok: false; readonly reason: string };

/** Valor tipado → string canônica do ledger (fail-closed: valor fora do contrato do tipo é recusado). */
export function encodeTrParamValue(def: VariableDef2, raw: unknown): EncodeResult {
  const n = normalizeValue2(def, raw);
  if (!n.ok) return { ok: false, reason: n.reason };
  const encoded = templateCanonicalJson(n.value);
  if (encoded.length > 60_000) return { ok: false, reason: "valor excede o tamanho permitido" };
  return { ok: true, encoded, value: n.value };
}

export type DecodeResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

/** String do ledger → valor tipado do catálogo ATUAL (incompatível com o catálogo ⇒ não aplicado, nunca coagido). */
export function decodeTrParamValue(def: VariableDef2, stored: unknown): DecodeResult {
  if (typeof stored !== "string") return { ok: false, reason: "valor armazenado fora do contrato" };
  let raw: unknown;
  try { raw = JSON.parse(stored); } catch { return { ok: false, reason: "valor armazenado ilegível" }; }
  const n = normalizeValue2(def, raw);
  return n.ok ? { ok: true, value: n.value } : { ok: false, reason: n.reason };
}

export interface ResolvedTrParam {
  readonly name: string;
  readonly status: "SET" | "UNSET" | "INVALID" | "CONFLICT";
  readonly value?: unknown;
  readonly reason?: string;
  readonly field: CanonicalField;
}

/** Resolve os parâmetros do TR das AFIRMAÇÕES do ledger (já filtradas por organizationId + processId pelo chamador). */
export function resolveTrParams(defs: readonly VariableDef2[], assertions: readonly FactAssertion[]): Map<string, ResolvedTrParam> {
  const out = new Map<string, ResolvedTrParam>();
  for (const def of defs) {
    const field = resolveField(trParamPath(def.name), assertions);
    if (field.status === "conflict") { out.set(def.name, { name: def.name, status: "CONFLICT", reason: "afirmações divergentes de mesma autoridade", field }); continue; }
    if (field.value === null) { out.set(def.name, { name: def.name, status: "UNSET", field }); continue; }
    const d = decodeTrParamValue(def, field.value);
    out.set(def.name, d.ok ? { name: def.name, status: "SET", value: d.value, field } : { name: def.name, status: "INVALID", reason: d.reason, field });
  }
  return out;
}

/** Digest dos parâmetros VIGENTES (valor + origem): muda ⇔ algum parâmetro estruturado do TR muda. */
export function trParamsDigest(params: ReadonlyMap<string, ResolvedTrParam>): string {
  const rows = [...params.values()].filter((p) => p.status !== "UNSET")
    .map((p) => `${p.name}=${p.status}:${p.field.valueHash ?? ""}:${p.field.source ? `${p.field.source.type}:${p.field.source.id}:${p.field.source.version}` : ""}`)
    .sort();
  return createHash("sha256").update(`${TR_PARAMS_VERSION}\n${rows.join("\n")}`).digest("hex");
}

/** Hash curto do valor codificado (base da superação consciente `basisValueHash`). */
export const encodedValueHash = (encoded: string): string => factValueHash(encoded);
