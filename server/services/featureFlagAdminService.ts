/**
 * C.3A-OPS — Serviço canônico de CONTROLE INSTITUCIONAL de feature flags tenant-aware.
 *
 * A menor superfície governada para CONSULTAR e ALTERAR overrides em `tenant_feature_flags`, de forma
 * auditável, replay-safe, multi-tenant e fail-closed. Reutiliza infraestrutura existente — NÃO cria um
 * segundo mecanismo de flags, idempotência ou auditoria:
 *   - avaliação: mesma ordem de `featureFlagService.isFeatureEnabled` (kill-switch → tenant → global → default);
 *   - idempotência: serviço ÚNICO `runWithIdempotency` (operação "feature-flag.set");
 *   - persistência: UPSERT em `tenant_feature_flags` (PK organizationId+flagName);
 *   - auditoria ATÔMICA: `activity_logs` gravado NO MESMO `tx` do UPSERT (nunca via `logActivity`
 *     fail-silent) — se a auditoria falhar, a transação inteira sofre rollback e a flag NÃO muda.
 *
 * Autoridade dos nomes de flag: a avaliação (`isFeatureEnabled`) resolve um override de tenant sem
 * exigir linha no registro global `feature_flags` (que hoje semeia apenas kill-switches de Ops). Para
 * NÃO permitir nomes arbitrários, esta camada define um allowlist EXPLÍCITO de flags governáveis por
 * esta superfície. Escrever/consultar uma flag fora do allowlist é recusado com erro estável.
 *
 * Guarda de ambiente: LEITURA liberada em qualquer ambiente autorizado; ESCRITA em produção BLOQUEADA
 * por padrão no backend (`IS_PRODUCTION`, fonte canônica `server/config/env.ts`) — jamais confia em env
 * do cliente. A ÚNICA exceção é o subconjunto explícito `PRODUCTION_GOVERNABLE_TENANT_FLAGS` (política
 * centralizada em `tenantFlagWritePolicy`): ser governável em staging NÃO implica ser mutável em produção.
 */

import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { activityLogs, featureFlags, tenantFeatureFlags } from "../../drizzle/schema";
import { getOrganizationById } from "../db/organizations";
import { runWithIdempotency } from "./idempotencyService";
import { invalidateFlagCache } from "./featureFlagService";
import { APP_ENV, IS_PRODUCTION, type AppEnv } from "../config/env";
import { FF_DIRECT_CONTRACT_SHADOW } from "./directContractShadowService";
import { CANONICAL_INGESTION_FLAG } from "./ingestionUploadService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("FeatureFlagAdminService");

/**
 * Allowlist canônico de flags governáveis por ESTA superfície institucional (decisão explícita).
 * Contém a flag da C.3A (`FF_DIRECT_CONTRACT_SHADOW`) e a ingestão canônica (`FF_CANONICAL_INGESTION`).
 * Ampliar este conjunto é decisão arquitetural explícita, nunca um atalho: um nome fora daqui é
 * recusado. As flags aqui NÃO são kill-switches globais (que seguem o caminho `isGlobalFlagEnabled`).
 */
export const GOVERNABLE_TENANT_FLAGS: ReadonlyArray<string> = [FF_DIRECT_CONTRACT_SHADOW, CANONICAL_INGESTION_FLAG];

/**
 * Subconjunto EXTREMAMENTE restrito de `GOVERNABLE_TENANT_FLAGS` cuja ESCRITA é permitida em PRODUÇÃO
 * (sempre tenant-scoped, pelo mesmo caminho auditado). Match exato — sem wildcard, sem prefixo.
 * `FF_DIRECT_CONTRACT_SHADOW` fica de fora de propósito: continua mutável só em development/staging.
 */
export const PRODUCTION_GOVERNABLE_TENANT_FLAGS: ReadonlyArray<string> = [CANONICAL_INGESTION_FLAG];

/** Justificativa mínima (após trim) exigida para alterações em PRODUÇÃO. */
export const PRODUCTION_REASON_MIN_LENGTH = 15;

export function isGovernableFlag(flagName: string): boolean {
  return GOVERNABLE_TENANT_FLAGS.includes(flagName);
}

export function isProductionGovernableFlag(flagName: string): boolean {
  return isGovernableFlag(flagName) && PRODUCTION_GOVERNABLE_TENANT_FLAGS.includes(flagName);
}

export type TenantFlagWriteDecision = "allowed" | "not_governable" | "forbidden_in_production";

/**
 * Política ÚNICA de escrita (pura, sem I/O): decide se `flagName` pode ser alterada no ambiente dado.
 * Produção só aceita flags do subconjunto explícito de produção; os demais ambientes seguem o allowlist geral.
 */
export function tenantFlagWritePolicy(flagName: string, isProduction: boolean): TenantFlagWriteDecision {
  if (isProduction) return isProductionGovernableFlag(flagName) ? "allowed" : "forbidden_in_production";
  return isGovernableFlag(flagName) ? "allowed" : "not_governable";
}

function assertGovernable(flagName: string): void {
  if (!isGovernableFlag(flagName)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Flag desconhecida/não-governável por esta superfície: "${flagName}". Flags permitidas: ${GOVERNABLE_TENANT_FLAGS.join(", ")}.`,
    });
  }
}

export type FlagOrigin = "tenant" | "global" | "default";

export interface TenantFlagView {
  flagName: string;
  organizationId: number;
  /** Linha de override do tenant (ou null se não houver). */
  override: {
    enabled: boolean;
    percentage: number;
    expiresAt: Date | null;
    createdBy: number | null;
    createdAt: Date;
  } | null;
  /** Estado global (registro `feature_flags`), se existir. */
  global: { enabled: boolean } | null;
  /** Valor efetivo determinístico (percentage é sempre 100 nesta superfície — sem rollout aleatório). */
  effectiveValue: boolean;
  /** De onde o valor efetivo veio. */
  origin: FlagOrigin;
  /** Ambiente CANÔNICO do backend (APP_ENV) — a UI nunca decide isso pelo hostname. */
  environment: AppEnv;
  /** Se o backend permitiria uma ESCRITA desta flag neste ambiente. Fonte: `tenantFlagWritePolicy` + IS_PRODUCTION. */
  writeAllowed: boolean;
}

/** Núcleo da resolução (sem os metadados de ambiente, anexados pelo wrapper público). */
type TenantFlagCore = Omit<TenantFlagView, "environment" | "writeAllowed">;

/** É a mesma detecção de kill-switch de `featureFlagService` — mantida em sincronia. */
function isKillSwitch(flagName: string): boolean {
  return flagName.includes("_DISABLE") || flagName === "FF_OUTBOX_DISPATCHER_PAUSE";
}

/**
 * CONSULTA (read) governada — resolve o estado tenant-aware de uma flag para uma organização.
 * Reproduz a MESMA ordem de precedência de `isFeatureEnabled`, porém de forma determinística
 * (sem `Math.random`) e enriquecida (origem + override + expiry), sem alterar nada.
 */
export async function resolveTenantFlag(
  flagName: string,
  organizationId: number,
): Promise<TenantFlagView> {
  // Aditivo/não-quebra-contrato: anexa o ambiente CANÔNICO do backend e a permissão de escrita
  // (defesa em profundidade — a UI recebe a autoridade do backend, não infere pelo hostname).
  const core = await resolveTenantFlagCore(flagName, organizationId);
  return { ...core, environment: APP_ENV, writeAllowed: tenantFlagWritePolicy(flagName, IS_PRODUCTION) === "allowed" };
}

async function resolveTenantFlagCore(
  flagName: string,
  organizationId: number,
): Promise<TenantFlagCore> {
  assertGovernable(flagName);

  const db = await getDb();
  if (!db) {
    // Fail-closed sem DB: valor efetivo falso, origem default.
    return { flagName, organizationId, override: null, global: null, effectiveValue: false, origin: "default" };
  }

  const [globalFlag] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.name, flagName))
    .limit(1);

  const globalView = globalFlag ? { enabled: globalFlag.enabled } : null;

  // Kill-switch global ativo → efetivo sempre falso (overrides tudo), como em isFeatureEnabled.
  if (isKillSwitch(flagName) && globalFlag?.enabled === true) {
    return { flagName, organizationId, override: null, global: globalView, effectiveValue: false, origin: "global" };
  }

  const [tenantFlag] = await db
    .select()
    .from(tenantFeatureFlags)
    .where(
      and(
        eq(tenantFeatureFlags.organizationId, organizationId),
        eq(tenantFeatureFlags.flagName, flagName),
      ),
    )
    .limit(1);

  if (tenantFlag) {
    const notExpired = !tenantFlag.expiresAt || tenantFlag.expiresAt >= new Date();
    const override = {
      enabled: tenantFlag.enabled,
      percentage: tenantFlag.percentage ?? 100,
      expiresAt: tenantFlag.expiresAt ?? null,
      createdBy: tenantFlag.createdBy ?? null,
      createdAt: tenantFlag.createdAt,
    };
    if (notExpired) {
      // Determinístico: percentage é sempre 100 nesta superfície → efetivo = enabled.
      const effectiveValue = tenantFlag.enabled && override.percentage >= 100;
      return { flagName, organizationId, override, global: globalView, effectiveValue, origin: "tenant" };
    }
    // Override expirado: cai para o global/default, mas devolvemos o override (informativo).
    const effectiveValue = globalFlag?.enabled ?? false;
    return {
      flagName,
      organizationId,
      override,
      global: globalView,
      effectiveValue,
      origin: globalFlag ? "global" : "default",
    };
  }

  if (globalFlag) {
    return { flagName, organizationId, override: null, global: globalView, effectiveValue: globalFlag.enabled, origin: "global" };
  }

  return { flagName, organizationId, override: null, global: null, effectiveValue: false, origin: "default" };
}

export interface SetTenantFlagParams {
  organizationId: number;
  flagName: string;
  enabled: boolean;
  /** Data futura de expiração do override (opcional). null = sem expiração. */
  expiresAt?: Date | null;
  /** Justificativa institucional obrigatória (não vazia). */
  reason: string;
  /** Chave de idempotência obrigatória (replay-safe). */
  idempotencyKey: string;
  // Contexto do ator (auditoria imutável).
  actorUserId: number;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  orgName?: string | null;
  correlationId: string;
  requestId?: string;
}

export interface SetTenantFlagResult {
  replayed: boolean;
  flagName: string;
  organizationId: number;
  before: { enabled: boolean; expiresAt: Date | null } | null;
  after: { enabled: boolean; percentage: number; expiresAt: Date | null };
  effectiveValue: boolean;
  origin: FlagOrigin;
}

function payloadHashOf(p: SetTenantFlagParams): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        o: p.organizationId,
        f: p.flagName,
        e: p.enabled,
        x: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
        r: p.reason.trim(),
      }),
    )
    .digest("hex");
}

/**
 * ALTERA (write) governada — UPSERT do override do tenant com auditoria ATÔMICA e idempotência.
 *
 * Fail-closed e não-negociáveis:
 *   - ESCRITA em produção (IS_PRODUCTION) só para `PRODUCTION_GOVERNABLE_TENANT_FLAGS` — qualquer outra
 *     flag recebe FORBIDDEN estável ANTES de qualquer efeito; em produção a reason exige
 *     `PRODUCTION_REASON_MIN_LENGTH` caracteres;
 *   - flag precisa estar no allowlist governável (sem nomes arbitrários);
 *   - organização precisa existir (sem tenant desconhecido);
 *   - reason obrigatória não-vazia; idempotencyKey obrigatória;
 *   - percentage permanece 100 (SEM rollout gradual nesta superfície);
 *   - flag alterada + auditoria persistida ocorrem no MESMO `tx` (nunca flag-mudou-mas-auditoria-perdida).
 */
export async function setTenantFlag(p: SetTenantFlagParams): Promise<SetTenantFlagResult> {
  // 1) Guarda de ambiente — política centralizada (fonte canônica, jamais env do cliente). Em produção,
  //    somente o subconjunto explícito de produção passa; todo o resto falha ANTES de qualquer efeito.
  if (tenantFlagWritePolicy(p.flagName, IS_PRODUCTION) === "forbidden_in_production") {
    log.warn("feature_flag_set_denied_production", {
      flagName: p.flagName,
      organizationId: p.organizationId,
      actorUserId: p.actorUserId,
      correlationId: p.correlationId,
    });
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Alteração desta feature flag bloqueada em produção. Em produção, apenas as flags autorizadas " +
        `(${PRODUCTION_GOVERNABLE_TENANT_FLAGS.join(", ")}) podem ser alteradas, sempre por organização.`,
    });
  }

  // 2) Validações determinísticas (independentes de estado).
  assertGovernable(p.flagName);

  const reason = (p.reason ?? "").trim();
  if (!reason) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Justificativa (reason) é obrigatória e não pode ser vazia." });
  }
  if (IS_PRODUCTION && reason.length < PRODUCTION_REASON_MIN_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Em produção, a justificativa (reason) deve ter ao menos ${PRODUCTION_REASON_MIN_LENGTH} caracteres.`,
    });
  }
  if (!p.idempotencyKey?.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "idempotencyKey é obrigatória." });
  }
  if (p.expiresAt != null) {
    const when = new Date(p.expiresAt);
    if (Number.isNaN(when.getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "expiresAt inválido." });
    }
    if (when.getTime() <= Date.now()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "expiresAt deve ser uma data futura (ou null para sem expiração)." });
    }
  }

  // 3) Organização precisa existir (sem tenant desconhecido).
  const org = await getOrganizationById(p.organizationId);
  if (!org) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Organização ${p.organizationId} não encontrada.` });
  }

  const expiresAt = p.expiresAt != null ? new Date(p.expiresAt) : null;

  // 4) Idempotência PRIMEIRO: replay (mesma chave + mesmo payload) devolve o resultado anterior
  //    SEM reexecutar (sem 2ª alteração, sem 2ª auditoria). Payload diferente sob a mesma chave → CONFLICT.
  const { result, replayed } = await runWithIdempotency(
    {
      key: p.idempotencyKey,
      userId: p.actorUserId,
      organizationId: p.organizationId,
      operation: "feature-flag.set",
      payloadHash: payloadHashOf(p),
    },
    async (): Promise<SetTenantFlagResult> => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Banco indisponível — alteração de flag não pode ser auditada." });
      }

      // Transação ÚNICA: estado (UPSERT) + auditoria (INSERT em activity_logs) sem gravação parcial.
      // A auditoria é gravada DIRETO na tabela dentro do tx (não via logActivity fail-silent): se a
      // auditoria falhar, o UPSERT sofre rollback junto — impossível "flag mudou, auditoria perdida".
      return db.transaction(async (tx): Promise<SetTenantFlagResult> => {
        const priorRows = await tx
          .select()
          .from(tenantFeatureFlags)
          .where(
            and(
              eq(tenantFeatureFlags.organizationId, p.organizationId),
              eq(tenantFeatureFlags.flagName, p.flagName),
            ),
          )
          .for("update");
        const prior = priorRows[0] ?? null;
        const before = prior ? { enabled: prior.enabled, expiresAt: prior.expiresAt ?? null } : null;

        // UPSERT — percentage SEMPRE 100 (sem rollout gradual nesta superfície).
        await tx
          .insert(tenantFeatureFlags)
          .values({
            organizationId: p.organizationId,
            flagName: p.flagName,
            enabled: p.enabled,
            percentage: 100,
            expiresAt,
            createdBy: p.actorUserId,
          })
          .onDuplicateKeyUpdate({
            set: { enabled: p.enabled, percentage: 100, expiresAt, createdBy: p.actorUserId },
          });

        const after = { enabled: p.enabled, percentage: 100, expiresAt };

        // Auditoria append-only ATÔMICA. Todos os campos exigidos: ator, org, flag, antes/depois,
        // expiry antes/novo, reason, correlationId, idempotencyKey, timestamp (createdAt defaultNow).
        await tx.insert(activityLogs).values({
          organizationId: p.organizationId,
          processId: null,
          userId: p.actorUserId,
          actorName: p.actorName ?? null,
          actorEmail: p.actorEmail ?? null,
          actorRole: p.actorRole ?? null,
          orgName: p.orgName ?? null,
          sourceContext: "api",
          action: p.enabled ? "feature_flag_enabled" : "feature_flag_disabled",
          entityType: "feature_flag",
          entityId: null,
          correlationId: p.correlationId,
          requestId: p.requestId ?? null,
          details: JSON.stringify({
            flagName: p.flagName,
            organizationId: p.organizationId,
            before: before
              ? { enabled: before.enabled, expiresAt: before.expiresAt ? before.expiresAt.toISOString() : null }
              : null,
            after: { enabled: after.enabled, percentage: after.percentage, expiresAt: expiresAt ? expiresAt.toISOString() : null },
            reason,
            idempotencyKey: p.idempotencyKey,
          }),
        });

        const notExpired = !expiresAt || expiresAt >= new Date();
        const effectiveValue = p.enabled && notExpired;

        return {
          replayed: false,
          flagName: p.flagName,
          organizationId: p.organizationId,
          before,
          after,
          effectiveValue,
          origin: "tenant",
        };
      });
    },
  );

  // 5) Invalidação de cache após a operação — a leitura imediata reflete o novo estado (via DB).
  //    É apenas evicção em memória (não é efeito persistente), segura mesmo em replay.
  invalidateFlagCache(p.flagName, p.organizationId);

  if (!replayed) {
    log.info("feature_flag_set", {
      flagName: p.flagName,
      organizationId: p.organizationId,
      enabled: p.enabled,
      hasExpiry: expiresAt != null,
      environment: APP_ENV,
      actorUserId: p.actorUserId,
      correlationId: p.correlationId,
      origin: "featureFlagAdmin",
    });
  }

  return { ...result, replayed };
}
