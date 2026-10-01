/**
 * NEW-002 — contenção da exclusão física de conta por autoatendimento (`lgpd.deleteMyAccount`).
 *
 * O caminho antigo (`db.deleteUserData`) apagava FISICAMENTE processos legados do usuário, documentos,
 * parâmetros de edital, activity_logs (trilha de auditoria), comentários, vínculos de processo,
 * notificações, consentimentos e o próprio usuário — sem retenção, sem aprovação e sem rastreabilidade.
 * Decisão humana: DESATIVAR. A procedure continua registrada (o contrato da API não some
 * silenciosamente), mas recusa TODA chamada ANTES de qualquer leitura/escrita. A recusa é:
 *  - determinística: sempre `FORBIDDEN` com o token estável `ACCOUNT_HARD_DELETE_DISABLED` na mensagem;
 *  - sem detalhe sensível: a mensagem é idêntica para qualquer ator (usuário, admin/owner de órgão,
 *    admin de plataforma);
 *  - observável: evento estruturado `account_hard_delete_refused` apenas com actorUserId e
 *    correlationId — sem PII (sem e-mail, nome ou input do cliente).
 *
 * Nenhum dado é apagado, anonimizado ou alterado por este guard.
 *
 * Futuro (NÃO implementado aqui): uma capacidade governada de solicitação de remoção
 * (`accountRemovalRequest`) — com retenção, anonimização e aprovação do encarregado — exige revisão
 * jurídica prévia (LGPD × dever de guarda de documentos públicos) antes de qualquer implementação.
 */
import { TRPCError } from "@trpc/server";
import { serviceLogger } from "./observabilityService";

/** Token estável do desligamento da exclusão física de conta (não traduzir; usado por testes/cliente). */
export const ACCOUNT_HARD_DELETE_DISABLED = "ACCOUNT_HARD_DELETE_DISABLED";

/** Mensagem pública (pt-BR), idêntica para qualquer ator. */
export const ACCOUNT_HARD_DELETE_DISABLED_MESSAGE =
  "A exclusão de conta por autoatendimento não está disponível. A solicitação deve ser encaminhada ao " +
  "administrador da sua organização ou ao encarregado pelo tratamento de dados pessoais (DPO), para " +
  `tratamento por processo governado (${ACCOUNT_HARD_DELETE_DISABLED}).`;

const log = serviceLogger("accountRemovalGuard");

export interface AccountRemovalCallContext {
  user?: { id: number } | null;
  correlationId?: string | null;
}

/**
 * Recusa a exclusão física de conta por autoatendimento. Deve ser a PRIMEIRA instrução do handler.
 * Só `ctx.user.id` e `ctx.correlationId` são lidos do contexto.
 */
export function throwAccountHardDeleteDisabled(ctx?: AccountRemovalCallContext | null): never {
  log.warn("account_hard_delete_refused", {
    actorUserId: ctx?.user?.id ?? null,
    correlationId: ctx?.correlationId ?? null,
  });
  throw new TRPCError({ code: "FORBIDDEN", message: ACCOUNT_HARD_DELETE_DISABLED_MESSAGE });
}
