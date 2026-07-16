/**
 * RC-4.2.1 — Observability Repository (facade de persistência/recuperação).
 *
 * Separa a infraestrutura de observabilidade da sua persistência e consulta:
 *   Infraestrutura → Persistência → Consulta → Recuperação.
 * Nenhuma regra de negócio. Delega ao repositório Drizzle (degrada sem DB).
 */

import { insertObservability, getObservabilityByCorrelation, type ObservabilityRow } from "../../db/cognitiveObservability";
import type { CognitiveObservability } from "./cognitiveObservabilityService";

export interface ObservabilityPersistMeta {
  tenantId: number;
  replayHash: string;
  provider: string;
  executionStatus?: string;
}

/** Persiste a observabilidade (fire-and-forget seguro: nunca lança). */
export async function persistObservability(obs: CognitiveObservability, meta: ObservabilityPersistMeta): Promise<void> {
  try {
    await insertObservability({
      tenantId: meta.tenantId,
      correlationId: obs.correlationId,
      task: obs.task,
      replayHash: meta.replayHash,
      reasoningPlanId: obs.reasoningPlanId,
      reasoningPlanHash: obs.reasoningPlanHash,
      provider: meta.provider,
      latencyMs: obs.latencyMs,
      totalTokens: obs.tokenUsage.totalTokens,
      structuredOutputValid: obs.structuredOutputValid,
      executionStatus: meta.executionStatus ?? "completed",
      payload: obs,
    });
  } catch { /* persistência não pode quebrar o pipeline cognitivo */ }
}

/** Recupera a observabilidade persistida por correlationId (null se ausente/sem DB). */
export async function recoverObservabilityRow(correlationId: string): Promise<ObservabilityRow | null> {
  try {
    return await getObservabilityByCorrelation(correlationId);
  } catch {
    return null;
  }
}
