/**
 * RC-4.6.2 — Knowledge Binding Framework · Explainability (Part 8).
 *
 * Todo Binding se EXPLICA: por que existe, quem criou, qual artigo representa, qual KnowledgeUnit
 * representa, qual versão, qual autoridade e qual escopo. Nunca informação implícita. Determinístico.
 */

import type { KnowledgeBindingRegistry } from "./knowledgeBindingRegistry";
import type { KnowledgeBinding } from "./knowledgeBinding";
import { listVersions } from "./knowledgeBindingResolver";

export interface BindingExplanation {
  readonly bindingId: string;
  readonly reason: string;
  readonly createdBy: string;
  readonly article: string;
  readonly knowledgeUnit: string;
  readonly bindingType: string;
  readonly version: number;
  readonly status: string;
  readonly authority: string;
  readonly scope: string;
  readonly lineageId: string;
  readonly versions: readonly number[];
  readonly summary: string;
}

const TYPE_REASON: Record<KnowledgeBinding["bindingType"], string> = {
  PRIMARY: "Vínculo primário: a unidade representa diretamente o conteúdo do nó normativo.",
  SECONDARY: "Vínculo secundário: a unidade complementa o nó normativo.",
  SUPPLEMENTAL: "Vínculo suplementar: a unidade acrescenta material de apoio ao nó.",
  INTERPRETATIVE: "Vínculo interpretativo: a unidade interpreta o nó normativo.",
  REFERENCE: "Vínculo de referência: a unidade referencia o nó normativo.",
  REGULATORY: "Vínculo regulamentar: a unidade regulamenta o nó normativo.",
};

/** Explica um binding dentro do registro. Sempre estruturado — nunca só dados. */
export function explainBinding(registry: KnowledgeBindingRegistry, binding: KnowledgeBinding): BindingExplanation {
  const versions = listVersions(registry, binding.lineageId).map(v => v.version);
  return {
    bindingId: binding.bindingId,
    reason: TYPE_REASON[binding.bindingType],
    createdBy: binding.authority,
    article: binding.normativeNodeId,
    knowledgeUnit: binding.knowledgeUnitId,
    bindingType: binding.bindingType,
    version: binding.version,
    status: binding.status,
    authority: binding.authority,
    scope: binding.scope,
    lineageId: binding.lineageId,
    versions,
    summary: `Binding ${binding.bindingType} v${binding.version} (${binding.status}) liga o nó ${binding.normativeNodeId} à unidade ${binding.knowledgeUnitId}, autoridade ${binding.authority}, escopo ${binding.scope}.`,
  };
}
