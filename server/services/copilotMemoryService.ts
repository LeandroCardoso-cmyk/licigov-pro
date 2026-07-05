/**
 * Sprint 4.9 — Copilot Memory Service
 *
 * Memória contextual específica por copiloto e organização. Mantém um histórico
 * recente de interações (em memória, com chave determinística) que pode enriquecer
 * o contexto de reasoning. Multi-tenant: isolado por organizationId + copilotType.
 */

import { createHash } from "crypto";
import type { CopilotType } from "../domain/institutionalCopilot";

export interface MemoryEntry {
  readonly id: string;
  readonly organizationId: number;
  readonly copilotType: CopilotType;
  readonly query: string;
  readonly recommendationSummary: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

const MAX_ENTRIES = 20;
const _store = new Map<string, MemoryEntry[]>();

function memoryKey(organizationId: number, copilotType: CopilotType): string {
  return `${organizationId}:${copilotType}`;
}

export function recordMemory(params: {
  organizationId: number;
  copilotType: CopilotType;
  query: string;
  recommendationSummary: string;
  correlationId: string;
  createdAt?: string;
}): MemoryEntry {
  const id = createHash("sha256")
    .update(`cmem:${params.organizationId}:${params.copilotType}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  const entry: MemoryEntry = {
    id,
    organizationId: params.organizationId,
    copilotType: params.copilotType,
    query: params.query,
    recommendationSummary: params.recommendationSummary,
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
  const key = memoryKey(params.organizationId, params.copilotType);
  const existing = _store.get(key) ?? [];
  // Dedup por id determinístico; mantém as MAX_ENTRIES mais recentes.
  const next = [...existing.filter(e => e.id !== entry.id), entry].slice(-MAX_ENTRIES);
  _store.set(key, next);
  return entry;
}

export function getMemory(organizationId: number, copilotType: CopilotType): MemoryEntry[] {
  return _store.get(memoryKey(organizationId, copilotType)) ?? [];
}

/** Resumo textual da memória recente (para enriquecer o contexto do copiloto). */
export function summarizeMemory(organizationId: number, copilotType: CopilotType, limit = 5): string {
  const entries = getMemory(organizationId, copilotType).slice(-limit);
  if (entries.length === 0) return "";
  return entries.map(e => `- ${e.query} → ${e.recommendationSummary}`).join("\n");
}

export function clearMemory(organizationId: number, copilotType: CopilotType): void {
  _store.delete(memoryKey(organizationId, copilotType));
}
