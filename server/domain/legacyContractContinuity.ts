/**
 * Continuidade de contratos de processos anteriores (legado) — regras PURAS (sem I/O).
 *
 * Reaproveita dados já informados (registro do processo legado, alterações anteriores, término da vigência) em vez de
 * pedir de novo, SEM transformar declaração em verificação: tudo que vem do usuário sai marcado como DECLARADO.
 *
 *  - `composeAddendumTerm`: prazo do aditivo + término estruturado da vigência (texto auditável que vai ao termo);
 *  - `validatePriorAmendments` / `buildPriorAmendmentRow`: aditivos JÁ formalizados fora do sistema, registrados como
 *    histórico DECLARADO (continuam a numeração; nunca geram termo; nunca alteram o contrato);
 *  - `mergeLegacyRecordFields`: preenche objeto/origem a partir do registro operacional SEM sobrescrever o que o usuário digitou.
 */
import { createHash } from "crypto";
import { advanceAddendum, createContractAddendum, type ContractAddendum } from "./contractInstruments";
import { validLocalDate } from "./operationRecordSchedule";

/** Marca textual de informação declarada (não verificada) em termos, timeline e histórico. */
export const DECLARED_OUTSIDE_SYSTEM = "DECLARADO — formalizado fora do sistema, não verificado";

export const PRIOR_AMENDMENT_TYPES = ["prazo", "valor", "quantitativo", "qualitativo"] as const;
export type PriorAmendmentType = (typeof PRIOR_AMENDMENT_TYPES)[number];
export const MAX_PRIOR_AMENDMENTS = 20;

export interface PriorAmendmentInput {
  readonly type: PriorAmendmentType;
  readonly description?: string;
  readonly newTerm?: string;
  readonly newValue?: number;
  /** AAAA-MM-DD — data de assinatura declarada (opcional). */
  readonly signedOn?: string;
  /** Referência declarada ao ato (ex.: "1º Termo Aditivo, publicado em 12/03/2025"). */
  readonly reference?: string;
}

export const ADDENDUM_TERM_MAX = 255; // contract_addenda.new_term varchar(255)

const BR = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export type AddendumTermIssue = "END_DATE_INVALID" | "END_DATE_ONLY_FOR_TERM_ADDENDUM" | "TERM_TOO_LONG";

/**
 * Texto do prazo do aditivo. `newEndDate` (AAAA-MM-DD) só vale para aditivo de PRAZO e entra no texto do termo
 * ("… — término da vigência em DD/MM/AAAA"); o reagendamento do vencimento é feito pelo serviço a partir da MESMA data.
 */
export function composeAddendumTerm(params: { addendumType: string; newTerm?: string; newEndDate?: string }): { ok: true; newTerm: string } | { ok: false; issue: AddendumTermIssue } {
  const base = (params.newTerm ?? "").trim();
  if (params.newEndDate === undefined || params.newEndDate === "") return { ok: true, newTerm: base };
  if (params.addendumType !== "prazo") return { ok: false, issue: "END_DATE_ONLY_FOR_TERM_ADDENDUM" };
  if (!validLocalDate(params.newEndDate)) return { ok: false, issue: "END_DATE_INVALID" };
  const suffix = `término da vigência em ${BR(params.newEndDate)}`;
  const composed = base ? `${base} — ${suffix}` : suffix.charAt(0).toUpperCase() + suffix.slice(1);
  return composed.length > ADDENDUM_TERM_MAX ? { ok: false, issue: "TERM_TOO_LONG" } : { ok: true, newTerm: composed };
}

export function validatePriorAmendments(list: readonly PriorAmendmentInput[] | undefined): string[] {
  const issues: string[] = [];
  const items = list ?? [];
  if (items.length > MAX_PRIOR_AMENDMENTS) issues.push(`no máximo ${MAX_PRIOR_AMENDMENTS} aditivos anteriores`);
  items.forEach((a, i) => {
    if (!PRIOR_AMENDMENT_TYPES.includes(a.type)) issues.push(`aditivo anterior ${i + 1}: tipo inválido`);
    if (a.signedOn !== undefined && a.signedOn !== "" && !validLocalDate(a.signedOn)) issues.push(`aditivo anterior ${i + 1}: data de assinatura inválida`);
    if (a.newValue !== undefined && (!Number.isFinite(a.newValue) || a.newValue < 0)) issues.push(`aditivo anterior ${i + 1}: valor inválido`);
    if ((a.newTerm ?? "").length > 200) issues.push(`aditivo anterior ${i + 1}: prazo longo demais`);
  });
  return issues;
}

/** Linha de histórico DECLARADO: finalizado, origem documento externo, SEM termo gerado e SEM efeito no contrato. */
export function buildPriorAmendmentRow(params: {
  organizationId: number; contractId: string; sequence: number; input: PriorAmendmentInput; correlationId: string; createdAt: string;
}): ContractAddendum {
  const { input } = params;
  const bits = [
    input.description?.trim() ? input.description.trim().slice(0, 500) : "",
    input.signedOn ? `Assinado em ${BR(input.signedOn)}.` : "",
    `${DECLARED_OUTSIDE_SYSTEM}.`,
  ].filter(Boolean);
  const id = createHash("sha256").update(`add:${params.organizationId}:${params.contractId}:${params.sequence}`).digest("hex").slice(0, 20);
  let a = createContractAddendum({
    id, organizationId: params.organizationId, contractId: params.contractId, addendumType: input.type, sequence: params.sequence,
    justification: bits.join(" "), newValue: input.newValue ?? 0, newTerm: (input.newTerm ?? "").trim(),
    requestOrigin: "documento_externo", correlationId: params.correlationId, createdAt: params.createdAt,
  });
  a = advanceAddendum(a, "minuta", params.createdAt);
  a = advanceAddendum(a, "finalizado", params.createdAt);
  return { ...a, documentReference: (input.reference ?? "").trim().slice(0, 500) || DECLARED_OUTSIDE_SYSTEM };
}

export const LEGACY_RECORD_TYPES_FOR_CONTRACT = ["processo_licitatorio_legado", "contratacao_direta_legada", "contrato_externo"] as const;
export type LegacyRecordTypeForContract = (typeof LEGACY_RECORD_TYPES_FOR_CONTRACT)[number];

const RECORD_LABEL: Record<LegacyRecordTypeForContract, string> = {
  processo_licitatorio_legado: "Processo licitatório legado", contratacao_direta_legada: "Contratação direta legada", contrato_externo: "Contrato externo (cadastro rápido)",
};

/** Origem declarada derivada do registro (ex.: "Processo licitatório legado nº 45/2022 — pregão"). */
export function legacyRecordSourceReference(rec: { recordType: LegacyRecordTypeForContract; number: string; modality: string }): string {
  return `${RECORD_LABEL[rec.recordType]}${rec.number.trim() ? ` nº ${rec.number.trim()}` : ""}${rec.modality.trim() ? ` — ${rec.modality.trim()}` : ""}`.slice(0, 200);
}

/** Campos a reaproveitar do registro: o que o usuário digitou SEMPRE prevalece; vazio ⇒ usa o registro. */
export function mergeLegacyRecordFields(input: { object?: string; sourceReference?: string }, rec: { recordType: LegacyRecordTypeForContract; number: string; object: string; modality: string }): { object: string; sourceReference: string; reused: readonly ("object" | "sourceReference")[] } {
  const reused: ("object" | "sourceReference")[] = [];
  let object = (input.object ?? "").trim();
  if (!object && rec.object.trim()) { object = rec.object.trim(); reused.push("object"); }
  let sourceReference = (input.sourceReference ?? "").trim();
  if (!sourceReference) { sourceReference = legacyRecordSourceReference(rec); reused.push("sourceReference"); }
  return { object, sourceReference, reused };
}
