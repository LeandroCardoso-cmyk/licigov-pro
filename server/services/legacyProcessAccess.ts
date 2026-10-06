/**
 * SEM-086 — acesso a processo LEGADO (`processes`) pelas rotas de pacote/plataforma/download.
 *
 * Antes: `protectedProcedure` + `getProcessById(id)` + `process.ownerId === ctx.user.id`. Autorização só por `ownerId`,
 * sem organização: um usuário removido do órgão (membership revogada) continuava exportando os pacotes dos processos
 * que criou, e o log de atividade era gravado sem `organizationId`.
 *
 * Agora as rotas usam `tenantProcedure` (exige membership ATIVA vigente, resolvida pelo `tenantService`) e esta função:
 * o processo é buscado DENTRO da organização do contexto E continua exigindo a autoria (`ownerId`) — o contrato de
 * "somente o dono" não é ampliado. Processo inexistente, de outra organização ou de outro dono ⇒ MESMO erro.
 */
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const LEGACY_PROCESS_NOT_FOUND_MESSAGE = "Processo não encontrado ou sem permissão";

export async function requireOwnedProcessInTenant(
  ctx: { organizationId: number; user: { id: number } },
  processId: number,
) {
  const process = await db.getProcessByIdForOrganization(processId, ctx.organizationId);
  if (!process || process.ownerId !== ctx.user.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: LEGACY_PROCESS_NOT_FOUND_MESSAGE });
  }
  return process;
}
