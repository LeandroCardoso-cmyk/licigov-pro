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
  rawKey: keyof Pick<StagingItem, "rawDescription" | "rawQuantity" | "rawUnit" | "rawUnitPrice" | "rawTotalPrice">;
  kind: "text" | "decimal" | "unit";
}

/** Contrato por importType. Ausência ⇒ correção indisponível. */
export const CORRECTABLE_FIELDS: Record<string, CorrectableField[]> = {
  price_research: [
    { logical: "description", label: "Descrição",     rawKey: "rawDescription", kind: "text" },
    { logical: "quantity",    label: "Quantidade",    rawKey: "rawQuantity",    kind: "decimal" },
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
