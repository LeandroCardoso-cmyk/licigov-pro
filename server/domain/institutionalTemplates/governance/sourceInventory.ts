/**
 * INVENTÁRIO DA FONTE (pacote de proveniência do import) — domínio puro. Declara, para o modelo importado, quais entradas
 * existem (incluindo as "control-only"), quais tipos de condição, o mapeamento de anexos, as referências cruzadas e os slots de IA.
 * A matriz de prontidão CONFRONTA este inventário com o AST real e com as capacidades do sistema: o inventário sozinho nunca
 * prova nada. Seu SHA-256 (JSON canônico, `tpl-hash/1`) fica registrado na procedência; reenviar um inventário diferente ⇒ BLOCKED.
 */
import { templateHash } from "../semanticHash";
import { isSha256, type Sha256 } from "../types";

export type InputDisposition = "VARIABLE" | "CONTROL_ONLY" | "ITEMS_TABLE";
export const INPUT_DISPOSITIONS: readonly InputDisposition[] = ["VARIABLE", "CONTROL_ONLY", "ITEMS_TABLE"];
export type InventorySource = "PROCESS" | "DFD" | "ETP" | "TR" | "ITEMS" | "PARAMS" | "IDENTITY" | "CERTAME_CONFIG";
const INVENTORY_SOURCES: readonly string[] = ["PROCESS", "DFD", "ETP", "TR", "ITEMS", "PARAMS", "IDENTITY", "CERTAME_CONFIG"];

export interface InventoryInput {
  readonly key: string;
  readonly disposition: InputDisposition;
  /** Nome da variável do catálogo que recebe a entrada (obrigatório para VARIABLE/CONTROL_ONLY/ITEMS_TABLE). */
  readonly variable: string;
  readonly source?: InventorySource;
}

export interface SourceInventory {
  readonly schema: "tpl-source-inventory/1";
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: Sha256;
  readonly declared: { readonly inputsTotal: number; readonly controlOnlyInputs: number; readonly conditionTypes: number };
  readonly inputs: readonly InventoryInput[];
  readonly conditionTypes: readonly { readonly key: string; readonly variable: string }[];
  readonly annexes: readonly { readonly sourceId: string; readonly annexId: string }[];
  readonly crossReferences: readonly { readonly fromSection: string; readonly to: { readonly kind: "SECTION" | "ANNEX"; readonly id: string } }[];
  readonly aiSlots?: readonly { readonly slotKey: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 100_000;

/** Limite de tamanho do inventário (proteção contra abuso): 2.000 entradas / 500 condições / 200 anexos / 2.000 referências. */
export const INVENTORY_LIMITS = Object.freeze({ inputs: 2000, conditionTypes: 500, annexes: 200, crossReferences: 2000, aiSlots: 100 });

export function parseSourceInventory(raw: unknown): { ok: true; value: SourceInventory } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!isObj(raw)) return { ok: false, issues: ["inventário deve ser um objeto"] };
  if (raw.schema !== "tpl-source-inventory/1") issues.push("schema deve ser tpl-source-inventory/1");
  if (!str(raw.sourceLogicalVersion, 64)) issues.push("sourceLogicalVersion obrigatório");
  if (!isSha256(raw.sourceSha256)) issues.push("sourceSha256 inválido");
  const d = raw.declared;
  if (!isObj(d) || !count(d.inputsTotal) || !count(d.controlOnlyInputs) || !count(d.conditionTypes)) issues.push("declared.{inputsTotal,controlOnlyInputs,conditionTypes} devem ser inteiros ≥ 0");

  const arr = (k: string, max: number): unknown[] => {
    const v = raw[k];
    if (!Array.isArray(v)) { issues.push(`${k} deve ser lista`); return []; }
    if (v.length > max) { issues.push(`${k} excede o limite de ${max}`); return []; }
    return v;
  };
  const inputs = arr("inputs", INVENTORY_LIMITS.inputs);
  inputs.forEach((i, n) => {
    if (!isObj(i) || !str(i.key, 120) || !INPUT_DISPOSITIONS.includes(i.disposition as InputDisposition) || !str(i.variable, 80)
      || (i.source !== undefined && !INVENTORY_SOURCES.includes(i.source as string))) issues.push(`inputs[${n}] inválido`);
  });
  const conds = arr("conditionTypes", INVENTORY_LIMITS.conditionTypes);
  conds.forEach((c, n) => { if (!isObj(c) || !str(c.key, 120) || !str(c.variable, 80)) issues.push(`conditionTypes[${n}] inválido`); });
  const annexes = arr("annexes", INVENTORY_LIMITS.annexes);
  annexes.forEach((a, n) => { if (!isObj(a) || !str(a.sourceId, 120) || !str(a.annexId, 80)) issues.push(`annexes[${n}] inválido`); });
  const xrefs = arr("crossReferences", INVENTORY_LIMITS.crossReferences);
  xrefs.forEach((x, n) => {
    if (!isObj(x) || !str(x.fromSection, 80) || !isObj(x.to) || (x.to.kind !== "SECTION" && x.to.kind !== "ANNEX") || !str(x.to.id, 80)) issues.push(`crossReferences[${n}] inválido`);
  });
  if (raw.aiSlots !== undefined) {
    if (!Array.isArray(raw.aiSlots) || raw.aiSlots.length > INVENTORY_LIMITS.aiSlots) issues.push("aiSlots inválido");
    else raw.aiSlots.forEach((s, n) => { if (!isObj(s) || !str(s.slotKey, 80)) issues.push(`aiSlots[${n}] inválido`); });
  }
  return issues.length ? { ok: false, issues: issues.slice(0, 20) } : { ok: true, value: raw as unknown as SourceInventory };
}

/** SHA-256 canônico do inventário. */
export const inventoryHash = (inv: SourceInventory): Sha256 => templateHash(inv);

export function inventoryCounts(inv: SourceInventory): { inputsTotal: number; controlOnlyInputs: number; conditionTypes: number } {
  return {
    inputsTotal: inv.inputs.length,
    controlOnlyInputs: inv.inputs.filter((i) => i.disposition === "CONTROL_ONLY").length,
    conditionTypes: new Set(inv.conditionTypes.map((c) => c.key)).size,
  };
}
