/**
 * RC-4.6.2 — Knowledge Binding Framework · Amostra estrutural.
 *
 * Registro de exemplo que liga nós REAIS da árvore normativa da Lei 14.133 (RC-4.6.1) a
 * identificadores de KnowledgeUnit PLACEHOLDER (referências — NENHUM conteúdo jurídico). Demonstra
 * que qualquer artigo pode receber bindings sem alterar a arquitetura. Determinístico.
 */

import { createKnowledgeBinding } from "./knowledgeBinding";
import { evolveBinding } from "./bindingVersion";
import { createKnowledgeBindingRegistry, addBinding, type KnowledgeBindingRegistry } from "./knowledgeBindingRegistry";
import { buildFederalProcurementTree } from "../normative/normativeTree";
import { findByIdentifier } from "../normative/normativeQueries";

const T = "2026-01-01T00:00:00.000Z";

/**
 * Constrói um registro de bindings de exemplo para uma organização: vincula Art. 1º, Art. 2º e
 * Art. 3º da Lei 14.133 a unidades placeholder, com uma linhagem versionada (v1 → v2).
 * Determinístico. Referências apenas — sem conteúdo.
 */
export function sampleBindingRegistry(tenantId: number): KnowledgeBindingRegistry {
  const tree = buildFederalProcurementTree(tenantId);
  const art1 = findByIdentifier(tree, "Art. 1º")!;
  const art2 = findByIdentifier(tree, "Art. 2º")!;
  const art3 = findByIdentifier(tree, "Art. 3º")!;

  // Placeholder ids de KnowledgeUnit (nunca conteúdo — apenas referências estruturais).
  const b1v1 = createKnowledgeBinding({ tenantId, normativeNodeId: art1.id, knowledgeUnitId: "ku-placeholder-0001", bindingType: "PRIMARY", createdAt: T, updatedAt: T });
  const b1v2 = evolveBinding(b1v1, { status: "active", metadata: { revisao: 2 } }, T); // append-only v2
  const b2 = createKnowledgeBinding({ tenantId, normativeNodeId: art2.id, knowledgeUnitId: "ku-placeholder-0002", bindingType: "REFERENCE", createdAt: T, updatedAt: T });
  const b3 = createKnowledgeBinding({ tenantId, normativeNodeId: art3.id, knowledgeUnitId: "ku-placeholder-0003", bindingType: "INTERPRETATIVE", createdAt: T, updatedAt: T });

  let reg = createKnowledgeBindingRegistry();
  for (const b of [b1v1, b1v2, b2, b3]) reg = addBinding(reg, b);
  return reg;
}
