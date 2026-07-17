/**
 * RC-5.1 — "Tirar Dúvidas" · Observabilidade & Histórico (auditoria).
 *
 * Persiste (em memória, recuperável) o histórico de consultas e a observabilidade: pergunta,
 * tempos, quantidade de documentos/trechos, correlationId, replayId, tenant, usuário, timestamp.
 * Multi-tenant. Determinístico. Permite futura auditoria/persistência em banco.
 */

import type { InstitutionalConsultationAnswer } from "../domain/institutionalConsultation";

export interface ConsultationHistoryEntry {
  readonly answerId: string;
  readonly correlationId: string;
  readonly replayId: string;
  readonly tenantId: number;
  readonly userId: number;
  readonly question: string;
  readonly documentCount: number;
  readonly passageCount: number;
  readonly hasSufficientBasis: boolean;
  readonly retrievalTimeMs: number;
  readonly answerTimeMs: number;
  readonly createdAt: string;
  /** Snapshot completo da resposta (auditoria). */
  readonly answer: InstitutionalConsultationAnswer;
}

const _byTenant = new Map<number, ConsultationHistoryEntry[]>();
const _byCorrelation = new Map<string, ConsultationHistoryEntry>();
const MAX_PER_TENANT = 500;

export function recordConsultation(entry: ConsultationHistoryEntry): void {
  const arr = _byTenant.get(entry.tenantId) ?? [];
  arr.push(entry);
  if (arr.length > MAX_PER_TENANT) arr.splice(0, arr.length - MAX_PER_TENANT);
  _byTenant.set(entry.tenantId, arr);
  _byCorrelation.set(entry.correlationId, entry);
  try {
    console.info("[consultation-observability]", JSON.stringify({
      correlationId: entry.correlationId, replayId: entry.replayId, tenant: entry.tenantId, user: entry.userId,
      documents: entry.documentCount, passages: entry.passageCount, retrievalMs: entry.retrievalTimeMs, answerMs: entry.answerTimeMs,
    }));
  } catch { /* noop */ }
}

/** Histórico de um tenant (mais recentes primeiro), com isolamento multi-tenant. */
export function getConsultationHistory(tenantId: number, limit = 50): ConsultationHistoryEntry[] {
  return [...(_byTenant.get(tenantId) ?? [])].reverse().slice(0, limit);
}

export function getConsultationByCorrelation(correlationId: string): ConsultationHistoryEntry | null {
  return _byCorrelation.get(correlationId) ?? null;
}

export function clearConsultationHistory(): void { _byTenant.clear(); _byCorrelation.clear(); }
