/**
 * RC-4.5 — Legal Knowledge Foundation · KnowledgeBase (agregado + fixture estrutural).
 *
 * Container multi-tenant de unidades + referências. A base de exemplo é ESTRUTURAL
 * (placeholders — NENHUMA norma real / Lei 14.133 / acórdão / doutrina), usada apenas para
 * validar a fundação. Determinística.
 */

import { createLegalKnowledgeUnit, type LegalKnowledgeUnit } from "./legalKnowledgeUnit";
import { createKnowledgeReference, type KnowledgeReference } from "./knowledgeReference";
import { evolveUnit } from "./knowledgeVersion";

export interface KnowledgeBase {
  readonly units: readonly LegalKnowledgeUnit[];
  readonly references: readonly KnowledgeReference[];
}

export function createKnowledgeBase(units: LegalKnowledgeUnit[], references: KnowledgeReference[]): KnowledgeBase {
  return { units, references };
}

/**
 * Base ESTRUTURAL de exemplo (sem conteúdo jurídico) para uma organização. Serve apenas
 * para exercitar projeção/queries/validação/conflitos/versionamento. Determinística.
 */
export function structuralSampleBase(tenantId: number): KnowledgeBase {
  const T = "2026-01-01T00:00:00.000Z";
  // Unidades estruturais (títulos genéricos — nunca leis reais).
  const lei = createLegalKnowledgeUnit({ tenantId, type: "lei", title: "Unidade Primária (estrutura)", hierarchy: 1, jurisdiction: "federal", sourceReference: "SRC-PRIMARIA", effectiveDate: T, createdAt: T });
  const decreto = createLegalKnowledgeUnit({ tenantId, type: "decreto", title: "Unidade Secundária (estrutura)", hierarchy: 2, jurisdiction: "federal", sourceReference: "SRC-SECUNDARIA", effectiveDate: T, createdAt: T });
  const inNorm = createLegalKnowledgeUnit({ tenantId, type: "instrucao_normativa", title: "Unidade Complementar (estrutura)", hierarchy: 3, jurisdiction: "federal", sourceReference: "SRC-COMPLEMENTAR", effectiveDate: T, createdAt: T });
  // Evolução (v2) da unidade secundária — append-only, mesma linhagem.
  const decretoV2 = evolveUnit(decreto, { title: "Unidade Secundária (estrutura) — rev." }, T);

  const units = [lei, decreto, inNorm, decretoV2];
  const references = [
    createKnowledgeReference({ from: decreto.id, to: lei.id, type: "derived_from", explanation: "A unidade secundária deriva da primária.", strength: 0.9 }),
    createKnowledgeReference({ from: inNorm.id, to: decreto.id, type: "implements", explanation: "A unidade complementar implementa a secundária.", strength: 0.8 }),
    createKnowledgeReference({ from: inNorm.id, to: lei.id, type: "depends_on", explanation: "A unidade complementar depende da primária.", strength: 0.7 }),
    createKnowledgeReference({ from: decretoV2.id, to: decreto.id, type: "amends", explanation: "A versão 2 altera a versão 1.", strength: 0.6 }),
  ];
  return { units, references };
}

export { evolveUnit };
