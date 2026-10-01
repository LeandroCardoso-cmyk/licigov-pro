/**
 * R2 — desligamento GOVERNADO de superfícies legadas (inventário R2.1:
 * `docs/audits/R2_LEGACY_REACHABILITY_INVENTORY.md`, decisões humanas de 27/09/2026).
 *
 * A procedure continua registrada (o contrato da API não some silenciosamente), mas recusa TODA chamada ANTES de
 * qualquer leitura/escrita, IA, e-mail, S3 ou outro efeito colateral. A recusa é:
 *  - determinística: sempre `FORBIDDEN` com o token estável `LEGACY_ENDPOINT_DISABLED` na mensagem;
 *  - sem detalhe sensível: não revela existência de recurso, tenant ou dado;
 *  - observável: evento estruturado `legacy_endpoint_disabled` com procedure, superfície (LEG-xxx), tenant do
 *    contexto, ator e correlationId — sem PII e sem o input do cliente.
 *
 * Mesmo padrão de `domain/legacyPipeline.ts` (`LEGACY_PROCESS_PIPELINE_DISABLED`), generalizado para as superfícies
 * com tratamento DISABLE. Nenhum dado histórico é apagado ou alterado por este guard.
 */
import { TRPCError } from "@trpc/server";
import { serviceLogger } from "./observabilityService";

/** Token estável do desligamento governado (não traduzir; usado por testes/cliente). */
export const LEGACY_ENDPOINT_DISABLED = "LEGACY_ENDPOINT_DISABLED";

const log = serviceLogger("legacyEndpointGuard");

export interface LegacyEndpointCallContext {
  organizationId?: number | null;
  user?: { id: number } | null;
  correlationId?: string | null;
}

/**
 * Recusa uma chamada a uma superfície legada desativada. Deve ser a PRIMEIRA instrução do handler.
 * @param procedure nome qualificado da procedure (ex.: "documents.approveDocument")
 * @param surfaceId id da superfície no inventário R2.1 (ex.: "LEG-008")
 * @param ctx contexto tRPC (só organizationId/user.id/correlationId são lidos)
 * @param alternative caminho canônico sugerido ao usuário (opcional, texto curto)
 */
export function throwLegacyEndpointDisabled(
  procedure: string,
  surfaceId: string,
  ctx?: LegacyEndpointCallContext | null,
  alternative?: string,
): never {
  log.warn("legacy_endpoint_disabled", {
    procedure,
    surfaceId,
    organizationId: ctx?.organizationId ?? null,
    actorUserId: ctx?.user?.id ?? null,
    correlationId: ctx?.correlationId ?? null,
  });
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "Esta operação legada foi desativada" +
      (alternative ? `; utilize ${alternative}` : "") +
      ` (${LEGACY_ENDPOINT_DISABLED}).`,
  });
}
