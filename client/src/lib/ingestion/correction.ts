/**
 * PR B.2.2 — Definições de correção no cliente (puras/testáveis). Espelham a allowlist do servidor
 * (server/domain/importCorrectionFields.ts); o servidor é a autoridade que valida/normaliza.
 *
 * A correção é um OVERLAY sobre os `raw*` imutáveis. O conteúdo efetivo = raw + overlay.
 */
import type { StagingItem } from "./staging";

export interface CorrectableField {
  logical: "description" | "quantity" | "unit" | "unitPrice" | "totalPrice";
  label: string;
  /** Texto de apoio SEMPRE visível sob o campo (associado via aria-describedby). */
  helpText?: string;
  /** Ajuda contextual curta (ícone de informação com tooltip e rótulo acessível). */
  contextHelp?: string;
  rawKey: keyof Pick<StagingItem, "rawDescription" | "rawQuantity" | "rawUnit" | "rawUnitPrice" | "rawTotalPrice">;
  kind: "text" | "decimal" | "unit";
}

/**
 * Pesquisa de Preços — a quantidade revisada aqui é a do DOCUMENTO-FONTE (evidência importada; conceitualmente
 * `sourceQuantity`), NÃO a quantidade a contratar. Corrigi-la significa corrigir uma extração que não corresponde
 * ao documento (ex.: PDF = 10, extraído = 1). A quantidade prevista para contratação pertence ao planejamento do
 * processo (necessidade/itens) e não é exibida nem alterada nesta revisão.
 */
export const SOURCE_QUANTITY_LABEL = "Quantidade no documento";
export const SOURCE_QUANTITY_HELP = "Valor extraído do arquivo de origem. Altere somente se a extração não corresponder ao documento.";
export const SOURCE_QUANTITY_CONTEXT =
  "Esta quantidade pertence ao documento de Pesquisa de Preços. A quantidade efetivamente prevista para contratação é definida na necessidade/itens do processo.";

/**
 * Bloco de correção: corrige a EXTRAÇÃO do documento-fonte (ex.: documento = 10, extraído = 1 → 10), nunca edita
 * dados da contratação (a quantidade prevista pertence ao planejamento/necessidade do processo).
 */
export const CORRECTION_SECTION_TITLE = "Corrigir extração do documento";
export const CORRECTION_SCOPE_NOTE = "Altere somente informações que foram extraídas incorretamente do arquivo de origem.";

/** Contrato por importType. Ausência ⇒ correção indisponível. */
export const CORRECTABLE_FIELDS: Record<string, CorrectableField[]> = {
  price_research: [
    { logical: "description", label: "Descrição",     rawKey: "rawDescription", kind: "text" },
    { logical: "quantity",    label: SOURCE_QUANTITY_LABEL, rawKey: "rawQuantity", kind: "decimal",
      helpText: SOURCE_QUANTITY_HELP, contextHelp: SOURCE_QUANTITY_CONTEXT },
    { logical: "unit",        label: "Unidade",       rawKey: "rawUnit",        kind: "unit" },
    { logical: "unitPrice",   label: "Preço unitário",rawKey: "rawUnitPrice",   kind: "decimal" },
    { logical: "totalPrice",  label: "Preço total",   rawKey: "rawTotalPrice",  kind: "decimal" },
  ],
};

export function isCorrectable(importType: string | undefined): boolean {
  return !!importType && Object.prototype.hasOwnProperty.call(CORRECTABLE_FIELDS, importType);
}

function overlayOf(item: StagingItem): Record<string, string | null> {
  const p = item.correctedPayload;
  return p && typeof p === "object" ? (p as Record<string, string | null>) : {};
}

/** Valor ORIGINAL (raw) de um campo lógico. */
export function originalValue(item: StagingItem, f: CorrectableField): string | null {
  return (item[f.rawKey] as string | null | undefined) ?? null;
}

/** Valor EFETIVO atual (overlay vence sobre raw). */
export function effectiveValue(item: StagingItem, f: CorrectableField): string | null {
  const overlay = overlayOf(item);
  return Object.prototype.hasOwnProperty.call(overlay, f.logical) ? overlay[f.logical] : originalValue(item, f);
}

export function isCorrected(item: StagingItem): boolean {
  return (item.correctionRevision ?? 0) > 0;
}

/** Reduz o formulário de edição a apenas os campos ALTERADOS vs. o efetivo atual (patch mínimo). */
export function buildCorrectionPatch(
  item: StagingItem,
  fields: CorrectableField[],
  draft: Record<string, string>,
): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const f of fields) {
    const current = effectiveValue(item, f) ?? "";
    const next = (draft[f.logical] ?? "").trim();
    if (next !== String(current).trim()) patch[f.logical] = next;
  }
  return patch;
}
