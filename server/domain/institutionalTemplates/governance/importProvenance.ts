/**
 * PROCEDÊNCIA da importação (piloto Edital) — domínio puro. Registrada no ledger de decisões (assunto = revisão exata) no
 * momento do registro/importação do modelo; não transita a revisão. Guarda a identidade declarada do modelo (templateKey,
 * displayName, escopo), a versão lógica e o SHA-256 da fonte e o resumo do inventário de entradas (hash + contagens).
 *
 * `displayName`/`templateKey` são metadados de apresentação e rastreio: NUNCA alteram identidade, binding ou resolução (a
 * autoridade segue sendo a identidade + a revisão exata fixada por binding).
 */
import type { InstitutionalDecision } from "../../institutionalDecision";
import { isSha256 } from "../types";
import { decodeKv, encodeKv } from "./kv";
import { readScope, SCOPE_DIMENSIONS, type ScopeView } from "./scopeDimensions";

export const IMPORT_PROVENANCE_SUBJECT = "institutional_template.import_provenance" as const;
export const IMPORT_PROVENANCE_DECISION_TYPE = "template_import_provenance" as const;
export const IMPORT_PROVENANCE_OUTCOME = "registrado" as const;

const KEYS = [
  "templateKey", "displayName", "sourceLogicalVersion", "sourceSha256", "sourceFormat", "revisionSemanticHash", "recordedAt",
  "inventorySha256", "inputsTotal", "controlOnlyInputs", "conditionTypes",
  "scope.modality", "scope.form", "scope.platform", "scope.regime", "scope.criterion",
] as const;

export interface ImportProvenanceInput {
  readonly templateKey: string;
  readonly displayName: string;
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: string;
  readonly sourceFormat: string;
  readonly inventory?: { readonly sha256: string; readonly inputsTotal: number; readonly controlOnlyInputs: number; readonly conditionTypes: number };
  readonly scope: ScopeView;
}

export interface ImportProvenance {
  readonly decisionId: string;
  readonly revisionId: string;
  readonly templateKey: string;
  readonly displayName: string;
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: string;
  readonly sourceFormat: string;
  readonly revisionSemanticHash: string;
  readonly recordedByUserId: number;
  readonly recordedAt: string;
  readonly inventory: { readonly sha256: string; readonly inputsTotal: number; readonly controlOnlyInputs: number; readonly conditionTypes: number } | null;
  readonly scope: ScopeView;
}

export const TEMPLATE_KEY_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

export function validateImportProvenanceInput(i: ImportProvenanceInput): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  if (!TEMPLATE_KEY_RE.test(i.templateKey)) out.push({ field: "templateKey", message: "templateKey: MAIÚSCULAS, dígitos e '_' (ex.: EDITAL_PREGAO_ELETRONICO_BLL)" });
  if (i.displayName.trim() === "" || i.displayName.length > 200 || /[\r\n]/.test(i.displayName)) out.push({ field: "displayName", message: "displayName obrigatório (até 200 caracteres, uma linha)" });
  if (i.sourceLogicalVersion.trim() === "" || i.sourceLogicalVersion.length > 64) out.push({ field: "sourceLogicalVersion", message: "versão lógica da fonte obrigatória" });
  if (!isSha256(i.sourceSha256)) out.push({ field: "sourceSha256", message: "SHA-256 da fonte inválido (64 hex minúsculos)" });
  if (i.inventory && !isSha256(i.inventory.sha256)) out.push({ field: "inventory.sha256", message: "SHA-256 do inventário inválido" });
  return out;
}

export function encodeImportProvenance(i: ImportProvenanceInput, ctx: { readonly revisionSemanticHash: string; readonly recordedAt: string }): string[] {
  const lines = [
    encodeKv("templateKey", i.templateKey), encodeKv("displayName", i.displayName), encodeKv("sourceLogicalVersion", i.sourceLogicalVersion),
    encodeKv("sourceSha256", i.sourceSha256), encodeKv("sourceFormat", i.sourceFormat),
    encodeKv("revisionSemanticHash", ctx.revisionSemanticHash), encodeKv("recordedAt", ctx.recordedAt),
  ];
  if (i.inventory) {
    lines.push(encodeKv("inventorySha256", i.inventory.sha256), encodeKv("inputsTotal", String(i.inventory.inputsTotal)),
      encodeKv("controlOnlyInputs", String(i.inventory.controlOnlyInputs)), encodeKv("conditionTypes", String(i.inventory.conditionTypes)));
  }
  const scope = readScope(i.scope);
  for (const d of SCOPE_DIMENSIONS) if (scope[d] !== undefined) lines.push(encodeKv(`scope.${d}`, scope[d]!));
  return lines;
}

export function decodeImportProvenance(d: InstitutionalDecision): ImportProvenance | null {
  if (d.subjectType !== IMPORT_PROVENANCE_SUBJECT || d.decisionType !== IMPORT_PROVENANCE_DECISION_TYPE || d.outcome !== IMPORT_PROVENANCE_OUTCOME) return null;
  const { values: v } = decodeKv(d.evidence, KEYS);
  for (const k of ["templateKey", "displayName", "sourceLogicalVersion", "sourceSha256", "sourceFormat", "revisionSemanticHash", "recordedAt"] as const) if (!v[k]) return null;
  if (!isSha256(v.sourceSha256) || !isSha256(v.revisionSemanticHash)) return null;
  const n = (s: string | undefined): number | null => (s !== undefined && /^\d{1,6}$/.test(s) ? Number(s) : null);
  const inv = v.inventorySha256 && isSha256(v.inventorySha256) && n(v.inputsTotal) !== null && n(v.controlOnlyInputs) !== null && n(v.conditionTypes) !== null
    ? { sha256: v.inventorySha256, inputsTotal: n(v.inputsTotal)!, controlOnlyInputs: n(v.controlOnlyInputs)!, conditionTypes: n(v.conditionTypes)! }
    : null;
  const scope: Partial<Record<(typeof SCOPE_DIMENSIONS)[number], string>> = {};
  for (const dim of SCOPE_DIMENSIONS) { const s = v[`scope.${dim}`]; if (s) scope[dim] = s; }
  return {
    decisionId: d.id, revisionId: d.subjectId, templateKey: v.templateKey, displayName: v.displayName,
    sourceLogicalVersion: v.sourceLogicalVersion, sourceSha256: v.sourceSha256, sourceFormat: v.sourceFormat,
    revisionSemanticHash: v.revisionSemanticHash, recordedByUserId: d.recordedByUserId, recordedAt: v.recordedAt, inventory: inv, scope,
  };
}
