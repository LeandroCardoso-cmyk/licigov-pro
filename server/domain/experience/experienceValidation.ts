/**
 * RC-X.1 — Institutional Experience Framework · Validation.
 *
 * Valida o ExperienceKernel: contexto válido, capacidades com módulo, workspaces sempre com
 * Capability (Part 8), capacidades exigidas existentes no registro, ids únicos. Determinística.
 */

import type { InstitutionContext } from "./institutionContext";
import { isValidContext } from "./institutionContext";
import type { CapabilityRegistry } from "./capability";
import type { WorkspaceRegistry } from "./workspace";

export interface ExperienceValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validateExperience(
  context: InstitutionContext,
  capabilityRegistry: CapabilityRegistry,
  workspaceRegistry: WorkspaceRegistry,
): ExperienceValidation {
  const errors: string[] = [];

  if (!isValidContext(context)) errors.push("InstitutionContext inválido (tenant/institution)");

  // Capacidades: ids únicos + módulo declarado.
  const capIds = new Set<string>();
  for (const cap of capabilityRegistry.capabilities) {
    if (capIds.has(cap.id)) errors.push(`capacidade com id duplicado: ${cap.id}`);
    capIds.add(cap.id);
    if (!cap.requiredModule) errors.push(`capacidade ${cap.id}: sem módulo (requiredModule)`);
  }

  // Workspaces: ids únicos + ao menos uma Capability (Part 8) + capacidades existentes.
  const wsIds = new Set<string>();
  for (const ws of workspaceRegistry.workspaces) {
    if (wsIds.has(ws.id)) errors.push(`workspace com id duplicado: ${ws.id}`);
    wsIds.add(ws.id);
    if (ws.requiredCapabilities.length === 0) errors.push(`workspace ${ws.id}: sem Capability (Part 8)`);
    for (const c of ws.requiredCapabilities) {
      if (!capIds.has(c)) errors.push(`workspace ${ws.id}: capacidade inexistente ${c}`);
    }
    for (const a of ws.actions) {
      if (!capIds.has(a.capability)) errors.push(`workspace ${ws.id}: ação ${a.id} referencia capacidade inexistente ${a.capability}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
