/**
 * PR C.2 — Serviço de governança operacional CATMAT/CATSER (supervisionado).
 *
 * Orquestra a decisão HUMANA sobre uma sugestão CATMAT/CATSER:
 *   1. valida invariantes de negócio (domínio puro `catmatGovernance`);
 *   2. lê o limiar institucional VIGENTE (fail-closed — pode não existir);
 *   3. registra a decisão no LEDGER IMUTÁVEL, com proveniência, correlationId e o
 *      limiar em vigor no momento;
 *   4. garante idempotência canônica (mesma chave + mesmo payload → replay; mesma
 *      chave + payload diferente → CONFLICT) via `runWithIdempotency`.
 *
 * NUNCA fabrica código, NUNCA auto-confirma (o ator é sempre um humano autenticado),
 * NUNCA persiste conteúdo sensível ou cadeia-de-raciocínio no ledger.
 */

import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { runWithIdempotency } from "./idempotencyService";
import {
  validateDecision,
  decisionSource,
  type CATMATGovernanceDecision,
} from "../domain/catmatGovernance";
import {
  getActiveCatmatThreshold,
  insertCatmatDecision,
  type CatmatDecisionRecord,
} from "../db/catmatGovernance";

/** Sugestão real disponível para o item (proveniência do domínio determinístico). */
export interface AvailableSuggestion {
  readonly id: string;
  readonly catmatCode: string;
  readonly catmatDescription: string;
  readonly score: number;
  readonly source?: string | null;
}

export interface DecideCatmatParams {
  readonly organizationId: number;
  readonly actorUserId: number;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly itemId: string;
  readonly processId: string | null;
  readonly decision: CATMATGovernanceDecision;
  /** Sugestões reais do item — base para confirmar/rejeitar (o código nunca é inventado). */
  readonly suggestions: readonly AvailableSuggestion[];
  readonly suggestionId?: string | null;
  /** Código informado no override manual (`substituido`). */
  readonly catmatCode?: string | null;
  readonly catmatDescription?: string | null;
  readonly justification?: string | null;
}

export interface DecideCatmatResult {
  readonly decision: CatmatDecisionRecord;
  readonly replayed: boolean;
}

/** Hash estável do payload — detecta reuso da mesma chave com dados divergentes. */
function payloadHashOf(p: DecideCatmatParams): string {
  const canonical = JSON.stringify({
    itemId: p.itemId,
    decision: p.decision,
    suggestionId: p.suggestionId ?? null,
    catmatCode: (p.catmatCode ?? "").trim() || null,
    justification: (p.justification ?? "").trim() || null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Executa uma decisão supervisionada e a persiste no ledger imutável (idempotente).
 * Lança `BAD_REQUEST` quando a decisão viola as invariantes (fail-closed).
 */
export async function decideCatmat(params: DecideCatmatParams): Promise<DecideCatmatResult> {
  const suggestionCodes = params.suggestions.map(s => s.catmatCode);

  // Sugestão decidida (quando aplicável) → proveniência/score/descrição auditáveis.
  // Resolvida por id (confirmar/rejeitar sobre uma sugestão) ou por código.
  const decided =
    params.suggestionId
      ? params.suggestions.find(s => s.id === params.suggestionId) ?? null
      : params.suggestions.find(s => s.catmatCode === (params.catmatCode ?? "").trim()) ?? null;

  // Código a fixar: só existe em confirmar/substituir. Nunca fabricado:
  //   - confirmar  → código da sugestão decidida (validado a seguir como real);
  //   - substituir → código informado explicitamente pelo servidor.
  const resolvedCode =
    params.decision === "confirmado"
      ? (decided?.catmatCode ?? ((params.catmatCode ?? "").trim() || null))
      : params.decision === "substituido"
        ? ((params.catmatCode ?? "").trim() || null)
        : null;

  // Valida com o código EFETIVO (o de confirmar vem sempre de uma sugestão real).
  const validation = validateDecision({
    decision: params.decision,
    catmatCode: resolvedCode,
    justification: params.justification,
    suggestionCodes,
  });
  if (!validation.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Decisão CATMAT inválida: ${validation.reason}` });
  }

  // Limiar VIGENTE no momento da decisão (fail-closed: pode ser null).
  const threshold = await getActiveCatmatThreshold(params.organizationId);

  const resolvedDescription =
    params.decision === "confirmado"
      ? decided?.catmatDescription ?? null
      : params.decision === "substituido"
        ? params.catmatDescription ?? null
        : null;

  const resolvedScore = params.decision === "confirmado" ? decided?.score ?? null : null;
  const source = decisionSource(params.decision, decided?.source ?? null);

  const { result, replayed } = await runWithIdempotency(
    {
      key: params.idempotencyKey,
      userId: params.actorUserId,
      organizationId: params.organizationId,
      operation: "catmat.decision",
      payloadHash: payloadHashOf(params),
    },
    async () => {
      const record = await insertCatmatDecision({
        organizationId: params.organizationId,
        processId: params.processId,
        itemId: params.itemId,
        decision: params.decision,
        suggestionId: params.suggestionId ?? decided?.id ?? null,
        catmatCode: resolvedCode,
        catmatDescription: resolvedDescription,
        source,
        score: resolvedScore,
        justification: (params.justification ?? "").trim() || null,
        thresholdMinScore: threshold?.minScore ?? null,
        thresholdConfigId: threshold?.id ?? null,
        actorUserId: params.actorUserId,
        correlationId: params.correlationId,
        idempotencyKey: params.idempotencyKey,
      });
      return record;
    },
  );

  if (!result) {
    // Sem DB (degrade) — reflete a decisão validada sem persistência durável.
    return {
      replayed,
      decision: {
        id: 0,
        decision: params.decision,
        itemId: params.itemId,
        processId: params.processId,
        suggestionId: params.suggestionId ?? decided?.id ?? null,
        catmatCode: resolvedCode,
        catmatDescription: resolvedDescription,
        source,
        score: resolvedScore,
        justification: (params.justification ?? "").trim() || null,
        thresholdMinScore: threshold?.minScore ?? null,
        thresholdConfigId: threshold?.id ?? null,
        actorUserId: params.actorUserId,
        correlationId: params.correlationId,
        createdAt: "",
      },
    };
  }

  return { decision: result, replayed };
}
