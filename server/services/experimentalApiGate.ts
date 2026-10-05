/**
 * R2 / LEG-028 — gate governado das APIs experimentais EM MEMÓRIA (decisão humana: DISABLE EM PRODUÇÃO).
 *
 * Um único ponto de decisão (`EXPERIMENTAL_API_CONFIG.allowed`, lido de `server/config/experimentalApis.ts`) aplicado
 * como o PRIMEIRO middleware de toda procedure dos routers listados em `LEG028_GATED_ROUTERS`:
 *
 *   publicProcedure.use(gate).concat(protectedProcedure | tenantProcedure)
 *
 * Assim o gate roda ANTES de autenticação/resolução de tenant (nenhuma leitura de membership nem auditoria de
 * acesso cross-tenant em banco para uma superfície desligada), ANTES da validação de input e ANTES do handler —
 * logo nenhum `Map`/array em memória desses routers/serviços é lido ou escrito quando a capability está desligada.
 *
 * Recusa: `throwLegacyEndpointDisabled(<path>, "LEG-028", ctx)` ⇒ `FORBIDDEN` + `LEGACY_ENDPOINT_DISABLED`
 * (mesmo contrato/observabilidade das demais superfícies R2 desativadas). Os routers continuam montados e com os
 * mesmos schemas — nada é apagado.
 */
import { TRPCError } from "@trpc/server";
import { middleware, protectedProcedure, publicProcedure, tenantProcedure } from "../_core/trpc";
import { EXPERIMENTAL_API_CONFIG } from "../config/experimentalApis";
import { throwLegacyEndpointDisabled } from "./legacyEndpointGuard";
import { serviceLogger } from "./observabilityService";

export const LEG028_SURFACE_ID = "LEG-028";

/** Nomes de montagem (em `server/routers.ts`) dos routers experimentais em memória gated por LEG-028. */
export const LEG028_GATED_ROUTERS = Object.freeze([
  "itemTr",
  "reviewWorkspace",
  "trComposition",
  "approvalWorkflow",
  "collaborationComments",
  "exports",
  "structuredExports",
  "webhooks",
  "clauses",
  "pilotReadiness",
  "productionReadiness",
  "itemAnalytics",
] as const);

/** Fábrica do middleware (a decisão é injetável para testes unitários do gate). */
export function createExperimentalApiGate(isAllowed: () => boolean) {
  return middleware(({ ctx, path, next }) => {
    if (!isAllowed()) {
      throwLegacyEndpointDisabled(path, LEG028_SURFACE_ID, ctx);
    }
    return next();
  });
}

/** Gate ligado à configuração do ambiente (fail-closed em production/staging; dev só com opt-in explícito). */
export const experimentalApiGate = createExperimentalApiGate(() => EXPERIMENTAL_API_CONFIG.allowed);

/** `protectedProcedure` precedido pelo gate LEG-028. */
export const experimentalProtectedProcedure = publicProcedure.use(experimentalApiGate).concat(protectedProcedure);

/** `tenantProcedure` precedido pelo gate LEG-028. */
export const experimentalTenantProcedure = publicProcedure.use(experimentalApiGate).concat(tenantProcedure);

/** Token estável da recusa de `organizationId` divergente do contexto (SEM-073). */
export const ORGANIZATION_INPUT_MISMATCH = "ORGANIZATION_INPUT_MISMATCH";

const gateLog = serviceLogger("experimentalApiGate");

/**
 * SEM-073 — a organização de uma procedure experimental vem SEMPRE do contexto autenticado (`tenantProcedure`).
 * O schema de entrada continua aceitando `organizationId` (opcional) apenas por compatibilidade com o cliente
 * congelado, mas ele NUNCA é fonte de autoridade: se vier e divergir da organização do contexto, a chamada é recusada
 * (`FORBIDDEN` + `ORGANIZATION_INPUT_MISMATCH`) ANTES de qualquer leitura/escrita do estado em memória — sem revelar
 * dado nem existência de outra organização. Coincidente ou ausente ⇒ usa a do contexto.
 */
export function organizationFromContext(
  ctx: { organizationId: number; user?: { id: number } | null; correlationId?: string | null },
  claimedOrganizationId: number | null | undefined,
  procedure: string,
): number {
  if (claimedOrganizationId !== undefined && claimedOrganizationId !== null && claimedOrganizationId !== ctx.organizationId) {
    gateLog.warn("organization_input_mismatch", {
      procedure,
      organizationId: ctx.organizationId,
      actorUserId: ctx.user?.id ?? null,
      correlationId: ctx.correlationId ?? null,
    });
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `A organização informada não corresponde à organização da sessão (${ORGANIZATION_INPUT_MISMATCH}).`,
    });
  }
  return ctx.organizationId;
}
