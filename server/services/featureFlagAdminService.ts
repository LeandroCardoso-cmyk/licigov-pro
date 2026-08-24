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
 * Guarda de ambiente: LEITURA liberada em qualquer ambiente autorizado; ESCRITA BLOQUEADA em produção
 * no backend (`IS_PRODUCTION`, fonte canônica `server/config/env.ts`) — jamais confia em env do cliente.
 */

import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { activityLogs, featureFlags, tenantFeatureFlags } from "../../drizzle/schema";
import { getOrganizationById } from "../db/organizations";
import { runWithIdempotency } from "./idempotencyService";
import { invalidateFlagCache } from "./featureFlagService";
import { IS_PRODUCTION } from "../config/env";
import { FF_DIRECT_CONTRACT_SHADOW } from "./directContractShadowService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("FeatureFlagAdminService");

/**
 * Allowlist canônico de flags governáveis por ESTA superfície institucional (decisão explícita).
 * Começa com a flag da C.3A (`FF_DIRECT_CONTRACT_SHADOW`) — o propósito declarado desta operação.
 * Ampliar este conjunto é decisão arquitetural explícita, nunca um atalho: um nome fora daqui é
 * recusado. As flags aqui NÃO são kill-switches globais (que seguem o caminho `isGlobalFlagEnabled`).
 */
export const GOVERNABLE_TENANT_FLAGS: ReadonlyArray<string> = [FF_DIRECT_CONTRACT_SHADOW];

export function isGovernableFlag(flagName: string): boolean {
  return GOVERNABLE_TENANT_FLAGS.includes(flagName);
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
}

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
 *   - ESCRITA BLOQUEADA em produção (IS_PRODUCTION) — erro estável, sem write, sem bypass;
 *   - flag precisa estar no allowlist governável (sem nomes arbitrários);
 *   - organização precisa existir (sem tenant desconhecido);
 *   - reason obrigatória não-vazia; idempotencyKey obrigatória;
 *   - percentage permanece 100 (SEM rollout gradual nesta superfície);
 *   - flag alterada + auditoria persistida ocorrem no MESMO `tx` (nunca flag-mudou-mas-auditoria-perdida).
 */
export async function setTenantFlag(p: SetTenantFlagParams): Promise<SetTenantFlagResult> {
  // 1) Guarda de ambiente — ESCRITA nunca em produção (fonte canônica, jamais env do cliente).
  if (IS_PRODUCTION) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Alteração de feature flag bloqueada em produção. Esta superfície opera apenas em development/staging; " +
        "mudanças de produção seguem processo institucional próprio.",
    });
  }

  // 2) Validações determinísticas (independentes de estado).
  assertGovernable(p.flagName);

  const reason = (p.reason ?? "").trim();
  if (!reason) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Justificativa (reason) é obrigatória e não pode ser vazia." });
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
    });
  }

  return { ...result, replayed };
}
