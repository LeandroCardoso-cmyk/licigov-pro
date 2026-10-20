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
import { isConfirmableSuggestionState, type SuggestionState } from "../domain/catmatMatching";
import {
  getActiveCatmatThreshold,
  getCatmatDecisionByIdempotencyKey,
  insertCatmatDecision,
  type CatmatDecisionRecord,
  type CatmatGovernanceExecutor,
} from "../db/catmatGovernance";
import { getDb } from "../db/connection";
import { lockIntelligentItemForClassification } from "../db/procurement";

/** Sugestão persistida do item, com o estado de verificação contra a evidência oficial do órgão. */
export interface AvailableSuggestion {
  readonly id: string;
  readonly catmatCode: string;
  readonly catmatDescription: string;
  readonly score: number;
  readonly source?: string | null;
  /**
   * true SÓ quando o código consta de consulta oficial registrada (catálogo CATMAT/CATSER) com a mesma descrição e
   * situação ativa. Ausente/false ⇒ não pode ser CONFIRMADO como classificação oficial (fail-closed).
   */
  readonly verified?: boolean;
  /**
   * M8 hardening — estado da sugestão. Só `busca_atual` (busca oficial mais recente) e `codigo_verificado` ("Verificar
   * código") podem ser CONFIRMADOS; histórico/origem não identificada/ausente ⇒ recusa (fail-closed).
   */
  readonly state?: SuggestionState;
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
  /**
   * Relê as sugestões do item DENTRO da transação da decisão (após o lock do item). Ausente ⇒ usa `suggestions`.
   * É a leitura decisiva: estado (busca atual/histórico/código verificado) e verificação oficial vigentes no commit.
   */
  readonly loadSuggestions?: (executor: CatmatGovernanceExecutor) => Promise<readonly AvailableSuggestion[]>;
  /** Efeitos de lineage da decisão NOVA (código no item, evento), executados na mesma transação do ledger. */
  readonly lineage?: (executor: CatmatGovernanceExecutor, record: CatmatDecisionRecord) => Promise<void>;
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
    // A descrição do override manual É dado persistido → participa da identidade do payload: mesma key
    // com descrição diferente ⇒ payload diferente ⇒ CONFLICT (nunca replay silencioso de descrição antiga).
    catmatDescription: (p.catmatDescription ?? "").trim() || null,
    justification: (p.justification ?? "").trim() || null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Confirmar exige PROVENIÊNCIA OFICIAL: pertencer à lista de sugestões não basta (sugestão legada/gerada localmente,
 * descrição divergente ou código inativo ⇒ recusa sem efeito). O limiar institucional não substitui esta verificação.
 * Avaliada DENTRO da execução idempotente: uma decisão nova sem verificação é recusada; o replay de uma decisão já
 * registrada devolve o registro original (a classificação não muda por mudança posterior da evidência).
 */
export function assertConfirmableSuggestion(
  decision: CATMATGovernanceDecision, decided: Pick<AvailableSuggestion, "verified" | "state"> | null,
): void {
  if (decision !== "confirmado") return;
  if (decided?.verified !== true) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "CATMAT_SUGGESTION_UNVERIFIED: esta sugestão não tem verificação no catálogo oficial CATMAT/CATSER e não pode ser "
        + "confirmada como classificação oficial. Use \"Buscar classificação\" para consultar o catálogo oficial, ou registre a "
        + "substituição manual (com justificativa) ou \"sem correspondência segura\". Nada foi gravado.",
    });
  }
  // Verificação oficial ≠ recomendação atual: sugestão que a busca mais recente não trouxe (ou de origem não
  // identificável) não é confirmada — o servidor busca de novo ou verifica o código. Decisões já registradas ficam intactas.
  if (!isConfirmableSuggestionState(decided.state)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "CATMAT_SUGGESTION_NOT_CURRENT: esta sugestão não pertence à busca oficial mais recente do item (é histórica ou "
        + "anterior ao registro da origem). A verificação oficial não a torna recomendação atual. Use \"Buscar classificação\" "
        + "novamente ou informe o código em \"Verificar código\". Nada foi gravado.",
    });
  }
}

/** Barreira de TESTE (interleavings determinísticos). Nunca configurada em produção. */
export type CatmatDecisionHookPhase = "before_lock" | "after_lock" | "before_commit";
let decisionHook: ((phase: CatmatDecisionHookPhase) => Promise<void> | void) | null = null;
export function __setCatmatDecisionHookForTests(fn: typeof decisionHook): void { decisionHook = fn; }

/** Campos efetivos da decisão, derivados das sugestões REAIS do item (o código de confirmar nunca é inventado). */
function resolveDecision(params: DecideCatmatParams, suggestions: readonly AvailableSuggestion[]) {
  // Sugestão decidida (quando aplicável) → proveniência/score/descrição auditáveis. Por id ou por código.
  const decided =
    params.suggestionId
      ? suggestions.find(s => s.id === params.suggestionId) ?? null
      : suggestions.find(s => s.catmatCode === (params.catmatCode ?? "").trim()) ?? null;
  // Código a fixar: confirmar → código da sugestão decidida; substituir → código informado pelo servidor.
  const code =
    params.decision === "confirmado"
      ? (decided?.catmatCode ?? ((params.catmatCode ?? "").trim() || null))
      : params.decision === "substituido"
        ? ((params.catmatCode ?? "").trim() || null)
        : null;
  const description =
    params.decision === "confirmado"
      ? decided?.catmatDescription ?? null
      : params.decision === "substituido"
        ? params.catmatDescription ?? null
        : null;
  const score = params.decision === "confirmado" ? decided?.score ?? null : null;
  // Substituição manual: declarada pelo servidor; só leva a fonte oficial no rótulo quando o MESMO código tem evidência
  // oficial verificada neste item (nunca apresenta a declaração do usuário como consulta oficial).
  const manualEvidence = params.decision === "substituido"
    ? suggestions.find((s) => s.verified === true && s.catmatCode === code)?.source ?? null
    : null;
  const source = decisionSource(params.decision, decided?.source ?? null, manualEvidence);
  return { decided, code, description, score, source };
}

/**
 * A chave já tem decisão no ledger (falha DEPOIS do commit, ou chave de idempotência vencida): devolve o registro original
 * — nunca reavalia nem duplica. Mesma chave com decisão diferente ⇒ CONFLICT (nada gravado).
 */
function assertSamePriorDecision(prior: CatmatDecisionRecord, params: DecideCatmatParams): void {
  const code = (params.catmatCode ?? "").trim() || null;
  const fixesCode = params.decision === "confirmado" || params.decision === "substituido";
  const same = prior.itemId === params.itemId && prior.decision === params.decision && prior.actorUserId === params.actorUserId
    && (!params.suggestionId || prior.suggestionId === params.suggestionId)
    && (!fixesCode || !code || prior.catmatCode === code)
    && (params.decision !== "substituido" || (prior.catmatCode === ((params.catmatCode ?? "").trim() || null)
      && (prior.catmatDescription ?? null) === (params.catmatDescription ?? null)))
    && (prior.justification ?? null) === ((params.justification ?? "").trim() || null);
  if (!same) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Idempotency-Key já registrada no ledger para outra decisão — operação recusada. Nada foi gravado.",
    });
  }
}

/**
 * Executa uma decisão supervisionada e a persiste no ledger imutável (idempotente).
 * Lança `BAD_REQUEST` quando a decisão viola as invariantes (fail-closed).
 *
 * Integridade sob concorrência (M8 hardening): a verificação DECISIVA (sugestão vigente, proveniência oficial) e a gravação
 * no ledger (com a fixação do código no item e o evento de linha do tempo) formam UMA transação, aberta com o lock do item
 * — o mesmo da busca oficial (`recordCatalogSearchMatches`) e de "Verificar código". Ordem de locks: item → sugestões →
 * evidência (compartilhado) → ledger. Uma busca que rebaixa a sugestão antes do lock faz a decisão ser recusada; uma
 * decisão que obtém o lock primeiro é registrada e a busca posterior não a altera. Sem retry automático: deadlock/timeout
 * ⇒ rollback integral e a chave fica reutilizável (o reenvio com a mesma chave reencontra a decisão, se ela foi gravada).
 */
export async function decideCatmat(params: DecideCatmatParams): Promise<DecideCatmatResult> {
  const suggestionCodes = params.suggestions.map(s => s.catmatCode);
  const pre = resolveDecision(params, params.suggestions);

  // Valida com o código EFETIVO (o de confirmar vem sempre de uma sugestão real).
  const validation = validateDecision({
    decision: params.decision,
    catmatCode: pre.code,
    justification: params.justification,
    suggestionCodes,
  });
  if (!validation.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Decisão CATMAT inválida: ${validation.reason}` });
  }

  // Limiar VIGENTE no momento da decisão. FAIL-CLOSED real: sem limiar institucional configurado, a
  // decisão governada é RECUSADA antes de qualquer efeito — nenhuma entrada no ledger, nenhum código
  // fixado no item, nenhum evento de timeline. Nunca inventa default nem auto-configura.
  const threshold = await getActiveCatmatThreshold(params.organizationId);
  if (!threshold) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Limiar institucional CATMAT/CATSER não configurado. Um gestor deve definir o limiar antes das decisões.",
    });
  }

  let recovered = false;
  const { result, replayed } = await runWithIdempotency(
    {
      key: params.idempotencyKey,
      userId: params.actorUserId,
      organizationId: params.organizationId,
      operation: "catmat.decision",
      payloadHash: payloadHashOf(params),
    },
    async () => {
      await decisionHook?.("before_lock");
      const db = await getDb();
      if (!db) {
        // Sem DB (degrade): valida sobre as sugestões recebidas; nada é persistido.
        assertConfirmableSuggestion(params.decision, pre.decided);
        return null;
      }
      return db.transaction(async (tx) => {
        if (!await lockIntelligentItemForClassification(params.itemId, params.organizationId, tx)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
        }
        await decisionHook?.("after_lock");
        const prior = await getCatmatDecisionByIdempotencyKey(params.organizationId, params.idempotencyKey, tx);
        if (prior) {
          assertSamePriorDecision(prior, params);
          recovered = true;
          return prior;
        }
        // Estado VIGENTE sob o lock do item (nunca o que foi lido antes da transação).
        const current = params.loadSuggestions ? await params.loadSuggestions(tx) : params.suggestions;
        const eff = resolveDecision(params, current);
        assertConfirmableSuggestion(params.decision, eff.decided);
        const record = await insertCatmatDecision({
          organizationId: params.organizationId,
          processId: params.processId,
          itemId: params.itemId,
          decision: params.decision,
          suggestionId: params.suggestionId ?? eff.decided?.id ?? null,
          catmatCode: eff.code,
          catmatDescription: eff.description,
          source: eff.source,
          score: eff.score,
          justification: (params.justification ?? "").trim() || null,
          thresholdMinScore: threshold.minScore,
          thresholdConfigId: threshold.id,
          actorUserId: params.actorUserId,
          correlationId: params.correlationId,
          idempotencyKey: params.idempotencyKey,
        }, tx);
        if (!record) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao registrar a decisão no ledger." });
        // A chave (única por órgão) foi gravada por OUTRA transação concorrente (outro ator/item) ⇒ recusa, nada gravado.
        if (record.itemId !== params.itemId || record.actorUserId !== params.actorUserId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Idempotency-Key já registrada no ledger para outra decisão — operação recusada. Nada foi gravado.",
          });
        }
        // Lineage na MESMA transação: código fixado no item e evento de linha do tempo (ou tudo, ou nada).
        await params.lineage?.(tx, record);
        await decisionHook?.("before_commit");
        return record;
      });
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
        suggestionId: params.suggestionId ?? pre.decided?.id ?? null,
        catmatCode: pre.code,
        catmatDescription: pre.description,
        source: pre.source,
        score: pre.score,
        justification: (params.justification ?? "").trim() || null,
        thresholdMinScore: threshold.minScore,
        thresholdConfigId: threshold.id,
        actorUserId: params.actorUserId,
        correlationId: params.correlationId,
        createdAt: "",
      },
    };
  }

  return { decision: result, replayed: replayed || recovered };
}
