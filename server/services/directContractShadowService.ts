/**
 * PR C.3A — Orquestrador SHADOW da Contratação Direta.
 *
 * LEGADO = EFFECTIVE (resposta oficial ao usuário). CANÔNICO = SHADOW (paralelo, sem efeito):
 * o Kernel Cognitivo (`executeCognitiveTask` / DIRECT_PROCUREMENT_REASONING) roda apenas para medir
 * equivalência estrutural, observar divergências e preparar migração futura. NUNCA substitui a resposta
 * legada, NUNCA altera documento/status/workflow, NUNCA decide juridicamente, NUNCA aparece na UI.
 *
 * Garantias:
 *  - Feature flag DB tenant-aware, default OFF / fail-closed (`FF_DIRECT_CONTRACT_SHADOW`).
 *  - Idempotência canônica (`runWithIdempotency`) — replay não duplica execução/observabilidade.
 *  - Isolamento de falhas (Bloco G): esta função NUNCA lança; falha do shadow é observável, não derruba
 *    o legado (o chamador a dispara fire-and-forget).
 *  - Sem chain-of-thought, sem conteúdo integral: persiste apenas hashes + metadados estruturais.
 */

import { createHash } from "crypto";
import { isFeatureEnabled } from "./featureFlagService";
import { runWithIdempotency } from "./idempotencyService";
import { executeCognitiveTask } from "./aiExecutionEngine";
import { insertObservability } from "../db/cognitiveObservability";
import { serviceLogger } from "./observabilityService";
import {
  compareDirectContractShadow,
  type DirectContractDocType,
  type ShadowEquivalenceClass,
} from "../domain/directContractShadow";

export const FF_DIRECT_CONTRACT_SHADOW = "FF_DIRECT_CONTRACT_SHADOW";

const log = serviceLogger("DirectContractShadow");

export interface DirectContractShadowInput {
  organizationId: number;
  actorUserId: number;
  correlationId: string;
  docType: DirectContractDocType;
  directContract: {
    id: number;
    processId?: number | null;
    object?: string | null;
    value?: string | number | null;
    justification?: string | null;
    type?: string | null;
    legalArticleId?: number | null;
  };
  /** Conteúdo efetivo retornado pelo LEGADO (nunca alterado). null se o legado falhou. */
  legacyContent: string | null;
  legacyError?: boolean;
}

export interface DirectContractShadowResult {
  ran: boolean;
  reason?: "flag_off" | "no_db_or_degraded" | "error";
  replayed?: boolean;
  classification?: ShadowEquivalenceClass;
  divergenceType?: string | null;
  correlationId?: string;
  error?: string;
}

function effectiveInput(p: DirectContractShadowInput) {
  const dc = p.directContract;
  return {
    docType: p.docType,
    directContractId: dc.id,
    object: (dc.object ?? "").trim(),
    value: dc.value ?? null,
    type: dc.type ?? null,
    legalArticleId: dc.legalArticleId ?? null,
    justification: (dc.justification ?? "").trim(),
  };
}

function inputHashOf(p: DirectContractShadowInput): string {
  return createHash("sha256").update(JSON.stringify(effectiveInput(p))).digest("hex");
}

function buildQuery(p: DirectContractShadowInput): string {
  const e = effectiveInput(p);
  return [
    `Contratação direta — documento: ${e.docType}.`,
    e.object ? `Objeto: ${e.object}.` : "",
    e.value != null ? `Valor: ${String(e.value)}.` : "",
    e.justification ? `Justificativa: ${e.justification}.` : "",
  ].filter(Boolean).join(" ").slice(0, 4000);
}

/**
 * Dispara o shadow. NUNCA lança (Bloco G): retorna um resumo observável. O chamador deve invocar
 * fire-and-forget (a resposta ao usuário é sempre a legada e independe deste retorno).
 */
export async function runDirectContractShadow(p: DirectContractShadowInput): Promise<DirectContractShadowResult> {
  try {
    // Flag DB tenant-aware; ausência/sem-DB → false (fail-closed). Quando OFF: comportamento = legado puro.
    const enabled = await isFeatureEnabled(FF_DIRECT_CONTRACT_SHADOW, p.organizationId);
    if (!enabled) return { ran: false, reason: "flag_off" };

    const inputHash = inputHashOf(p);
    const key = `dc-shadow:${p.organizationId}:${p.directContract.id}:${p.docType}:${inputHash}`.slice(0, 200);
    // correlationId determinístico do shadow → observabilidade replay-safe (id estável por chave).
    const shadowCorrelationId = `dcshadow-${createHash("sha256").update(key).digest("hex").slice(0, 27)}`;

    const { result, replayed } = await runWithIdempotency(
      { key, userId: p.actorUserId, organizationId: p.organizationId, operation: "direct-contract.shadow", payloadHash: inputHash },
      async (): Promise<{ classification: ShadowEquivalenceClass; divergenceType: string | null }> => {
        const startedAt = Date.now();

        // Execução CANÔNICA (shadow) via gateway oficial. Resiliência é a do próprio Kernel.
        let canonicalContent: string | null = null;
        let canonicalError = false;
        let provider = "";
        let model = "";
        let totalTokens = 0;
        let structuredValid = false;
        try {
          const exec = await executeCognitiveTask({
            task: "DIRECT_PROCUREMENT_REASONING",
            tenantId: p.organizationId,
            userId: String(p.actorUserId),
            correlationId: shadowCorrelationId,
            businessDomain: "contratacao_direta",
            processId: p.directContract.processId != null ? String(p.directContract.processId) : undefined,
            query: buildQuery(p),
            lawRefs: ["Lei 14.133/2021"],
            responseType: "text",
          });
          canonicalContent = exec.response.content ?? "";
          provider = exec.context.outcome.provider;
          model = exec.context.outcome.model;
          totalTokens = exec.observability.tokenUsage.totalTokens;
          structuredValid = exec.validation.valid;
        } catch (err) {
          canonicalError = true;
          log.warn("shadow_canonical_failed", { organizationId: p.organizationId, directContractId: p.directContract.id, error: err instanceof Error ? err.message : String(err) });
        }

        const cmp = compareDirectContractShadow({
          docType: p.docType,
          legacyContent: p.legacyContent,
          canonicalContent,
          legacyError: !!p.legacyError || !p.legacyContent,
          canonicalError,
        });

        const durationMs = Math.max(0, Date.now() - startedAt);

        // Observabilidade persistida (reuso de cognitive_observability). Sem CoT, sem conteúdo integral:
        // apenas hashes + metadados estruturais + classificação. id estável por (correlationId, replayHash).
        try {
          await insertObservability({
            tenantId: p.organizationId,
            correlationId: shadowCorrelationId,
            task: "DIRECT_PROCUREMENT_REASONING",
            replayHash: inputHash,
            reasoningPlanId: "",
            reasoningPlanHash: "",
            provider,
            latencyMs: durationMs,
            totalTokens,
            structuredOutputValid: structuredValid,
            executionStatus: "shadow",
            payload: {
              shadowComparison: {
                mode: "shadow",
                effective: "legacy",
                operation: "direct-contract.shadow",
                docType: p.docType,
                organizationId: p.organizationId,
                actorUserId: p.actorUserId,
                directContractId: p.directContract.id,
                sourceCorrelationId: p.correlationId,
                canonicalCorrelationId: shadowCorrelationId,
                provider,
                model,
                classification: cmp.classification,
                divergenceType: cmp.divergenceType,
                legacyHash: cmp.legacyHash,
                canonicalHash: cmp.canonicalHash,
                legacySignals: cmp.legacy,
                canonicalSignals: cmp.canonical,
                durationMs,
              },
            },
          });
        } catch (err) {
          // Observabilidade não pode derrubar o shadow (que por sua vez não derruba o legado).
          log.warn("shadow_observability_failed", { organizationId: p.organizationId, error: err instanceof Error ? err.message : String(err) });
        }

        log.info("shadow_comparison", {
          organizationId: p.organizationId, directContractId: p.directContract.id, docType: p.docType,
          classification: cmp.classification, divergenceType: cmp.divergenceType, correlationId: shadowCorrelationId,
        });

        return { classification: cmp.classification, divergenceType: cmp.divergenceType };
      },
    );

    const r = result ?? { classification: "NOT_COMPARABLE" as ShadowEquivalenceClass, divergenceType: "degraded" };
    return { ran: true, replayed, classification: r.classification, divergenceType: r.divergenceType, correlationId: shadowCorrelationId };
  } catch (err) {
    // Bloco G — o shadow NUNCA derruba o legado; falha fica observável.
    log.warn("shadow_run_failed", { organizationId: p.organizationId, error: err instanceof Error ? err.message : String(err) });
    return { ran: true, reason: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
