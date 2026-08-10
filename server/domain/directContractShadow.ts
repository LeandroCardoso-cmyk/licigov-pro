/**
 * PR C.3A — Comparação de equivalência ESTRUTURAL (pura, determinística) entre a saída LEGADA
 * (efetiva) e a saída CANÔNICA (shadow) da Contratação Direta.
 *
 * NÃO é validação jurídica. Não produz julgamento ("correto"/"aprovado"/"melhor"). Apenas classifica
 * divergência estrutural observável, para medir equivalência antes de qualquer cutover futuro.
 * Não compara igualdade textual integral; compara sinais estruturais normalizados.
 */

import { createHash } from "crypto";

export type DirectContractDocType =
  | "termo_dispensa"
  | "termo_inexigibilidade"
  | "minuta_contrato"
  | "planilha_cotacao"
  | "mapa_comparativo";

export type ShadowEquivalenceClass =
  | "EQUIVALENT_STRUCTURE"
  | "STRUCTURAL_DIVERGENCE"
  | "MISSING_REQUIRED_FIELD"
  | "CANONICAL_ERROR"
  | "LEGACY_ERROR"
  | "NOT_COMPARABLE";

/** Sinais estruturais mínimos exigidos por tipo de documento (marcadores normalizados). */
const REQUIRED_SIGNALS: Record<DirectContractDocType, ReadonlyArray<{ key: string; test: (t: string) => boolean }>> = {
  termo_dispensa: [
    { key: "law_14133", test: (t) => t.includes("14.133") },
    { key: "object", test: (t) => t.includes("objeto") },
    { key: "justification", test: (t) => t.includes("justificativ") },
  ],
  termo_inexigibilidade: [
    { key: "law_14133", test: (t) => t.includes("14.133") },
    { key: "object", test: (t) => t.includes("objeto") },
    { key: "justification", test: (t) => t.includes("justificativ") },
  ],
  minuta_contrato: [
    { key: "law_14133", test: (t) => t.includes("14.133") },
    { key: "object", test: (t) => t.includes("objeto") },
    { key: "clauses", test: (t) => t.includes("cláusula") || t.includes("clausula") },
  ],
  planilha_cotacao: [
    { key: "object", test: (t) => t.includes("objeto") },
  ],
  mapa_comparativo: [
    { key: "object", test: (t) => t.includes("objeto") },
  ],
};

export interface ShadowStructuralSignals {
  readonly nonEmpty: boolean;
  readonly length: number;
  readonly sectionCount: number;       // nº de cabeçalhos markdown (##...) — proxy de seções
  readonly presentSignals: readonly string[];
  readonly missingSignals: readonly string[];
}

export interface ShadowComparison {
  readonly classification: ShadowEquivalenceClass;
  readonly divergenceType: string | null;
  readonly legacyHash: string;
  readonly canonicalHash: string;
  readonly legacy: ShadowStructuralSignals | null;
  readonly canonical: ShadowStructuralSignals | null;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s ?? "").digest("hex");
}

function normalize(s: string): string {
  return (s ?? "").toLowerCase();
}

function signalsOf(docType: DirectContractDocType, content: string): ShadowStructuralSignals {
  const norm = normalize(content);
  const required = REQUIRED_SIGNALS[docType] ?? [];
  const present: string[] = [];
  const missing: string[] = [];
  for (const sig of required) (sig.test(norm) ? present : missing).push(sig.key);
  const sectionCount = (content.match(/^#{1,6}\s/gm) ?? []).length;
  return {
    nonEmpty: content.trim().length > 0,
    length: content.length,
    sectionCount,
    presentSignals: present,
    missingSignals: missing,
  };
}

/**
 * Classifica a equivalência estrutural entre a saída legada e a canônica (shadow).
 * `legacyContent`/`canonicalContent` = null ⇒ erro/ausência do lado correspondente.
 */
export function compareDirectContractShadow(params: {
  docType: DirectContractDocType;
  legacyContent: string | null;
  canonicalContent: string | null;
  legacyError?: boolean;
  canonicalError?: boolean;
}): ShadowComparison {
  const { docType } = params;
  const legacyContent = params.legacyContent ?? "";
  const canonicalContent = params.canonicalContent ?? "";
  const legacyHash = sha256Hex(legacyContent);
  const canonicalHash = sha256Hex(canonicalContent);

  // Erros têm precedência (observáveis, não substituem nada).
  if (params.legacyError || legacyContent.trim().length === 0) {
    return { classification: "LEGACY_ERROR", divergenceType: "legacy_missing_or_failed", legacyHash, canonicalHash, legacy: null, canonical: canonicalContent ? signalsOf(docType, canonicalContent) : null };
  }
  if (params.canonicalError || canonicalContent.trim().length === 0) {
    return { classification: "CANONICAL_ERROR", divergenceType: "canonical_missing_or_failed", legacyHash, canonicalHash, legacy: signalsOf(docType, legacyContent), canonical: null };
  }

  const legacy = signalsOf(docType, legacyContent);
  const canonical = signalsOf(docType, canonicalContent);

  if (!REQUIRED_SIGNALS[docType]) {
    return { classification: "NOT_COMPARABLE", divergenceType: "unknown_doc_type", legacyHash, canonicalHash, legacy, canonical };
  }

  // Campo obrigatório: presente no legado mas ausente no canônico.
  const missingInCanonical = legacy.presentSignals.filter((k) => !canonical.presentSignals.includes(k));
  if (missingInCanonical.length > 0) {
    return { classification: "MISSING_REQUIRED_FIELD", divergenceType: `missing:${missingInCanonical.join(",")}`, legacyHash, canonicalHash, legacy, canonical };
  }

  // Mesmos sinais obrigatórios presentes dos dois lados ⇒ equivalência estrutural.
  const sameSignals =
    legacy.presentSignals.length === canonical.presentSignals.length &&
    legacy.presentSignals.every((k) => canonical.presentSignals.includes(k));
  if (sameSignals) {
    return { classification: "EQUIVALENT_STRUCTURE", divergenceType: null, legacyHash, canonicalHash, legacy, canonical };
  }

  return { classification: "STRUCTURAL_DIVERGENCE", divergenceType: "signal_set_differs", legacyHash, canonicalHash, legacy, canonical };
}
