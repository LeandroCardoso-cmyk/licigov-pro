/**
 * RC-4.6.2 — Knowledge Binding Framework · Validation.
 *
 * Valida o registro de bindings: ids únicos, bindings válidos, tipos válidos, isolamento
 * multi-tenant por linhagem e versionamento consistente (append-only). Determinística.
 */

import type { KnowledgeBindingRegistry } from "./knowledgeBindingRegistry";
import { isValidBinding } from "./knowledgeBinding";
import { buildBindingChains, isBindingChainConsistent } from "./bindingVersion";

export interface BindingValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validateBindingRegistry(registry: KnowledgeBindingRegistry): BindingValidation {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const b of registry.bindings) {
    if (ids.has(b.bindingId)) errors.push(`binding com id duplicado: ${b.bindingId}`);
    ids.add(b.bindingId);
    if (!isValidBinding(b)) errors.push(`binding inválido (tipo/tenant/nó/unidade/versão): ${b.bindingId}`);
  }

  // Consistência de linhagem: mesmo tenant/nó/unidade/tipo e versões sequenciais (append-only).
  for (const chain of buildBindingChains(registry.bindings)) {
    if (!isBindingChainConsistent(chain)) errors.push(`cadeia de versões inconsistente na linhagem ${chain.lineageId}`);
    const members = registry.bindings.filter(b => b.lineageId === chain.lineageId);
    const first = members[0];
    for (const b of members) {
      if (b.tenantId !== first.tenantId || b.normativeNodeId !== first.normativeNodeId
        || b.knowledgeUnitId !== first.knowledgeUnitId || b.bindingType !== first.bindingType) {
        errors.push(`linhagem ${chain.lineageId}: binding ${b.bindingId} diverge dos invariantes da linhagem`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
