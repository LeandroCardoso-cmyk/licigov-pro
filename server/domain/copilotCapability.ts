/**
 * Sprint 4.9 — Copilot Capability
 *
 * Representa uma capacidade especializada de um copiloto e o casamento entre a
 * intenção de uma consulta e as capacidades disponíveis. Puro e determinístico.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type CapabilityKind =
  | "orientar"
  | "estruturar"
  | "revisar"
  | "sugerir"
  | "explicar"
  | "fundamentar"
  | "identificar_risco"
  | "validar";

export interface CopilotCapability {
  readonly id: string;
  readonly organizationId: number;
  readonly copilotType: CopilotType;
  readonly name: string;
  readonly kind: CapabilityKind;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly createdAt: string;
}

export function createCopilotCapability(params: {
  organizationId: number;
  copilotType: CopilotType;
  name: string;
  kind: CapabilityKind;
  description?: string;
  keywords?: string[];
  createdAt?: string;
}): CopilotCapability {
  const id = createHash("sha256")
    .update(`cap:${params.organizationId}:${params.copilotType}:${params.name}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    copilotType: params.copilotType,
    name: params.name,
    kind: params.kind,
    description: params.description ?? "",
    keywords: params.keywords ?? [],
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Score de aderência (0-1) entre uma consulta e uma capacidade, por keywords. */
export function scoreCapabilityMatch(capability: CopilotCapability, query: string): number {
  const q = query.toLowerCase();
  if (capability.keywords.length === 0) return 0;
  let hits = 0;
  for (const kw of capability.keywords) {
    if (q.includes(kw.toLowerCase())) hits++;
  }
  return hits / capability.keywords.length;
}

export function matchesCapability(capability: CopilotCapability, query: string): boolean {
  return scoreCapabilityMatch(capability, query) > 0;
}
