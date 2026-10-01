/**
 * NEW-003 (P1 SECURITY) — contenção da exportação de dados pessoais por autoatendimento (`lgpd.exportMyData`).
 *
 * O caminho antigo (`db.exportUserData`) devolvia no corpo HTTP a linha COMPLETA de `users` — inclusive
 * `passwordHash`, `signaturePassword` (hash da senha de assinatura de parecer), `tokenVersion` (contador
 * de revogação de sessão) e `openId` (subject do JWT) — e, por usar `protectedProcedure` e filtrar
 * processos só por `ownerId`, entregava a um servidor DESLIGADO (membership inativa) documentos
 * institucionais legados do órgão do qual saiu (inclusive de outros autores, com `s3Key`/`fileUrl`).
 * Nenhuma trilha de auditoria era gravada.
 *
 * Decisão humana: DESATIVAR agora. A procedure continua registrada (o contrato da API não some
 * silenciosamente), mas recusa TODA chamada ANTES de qualquer leitura. A recusa é:
 *  - determinística: sempre `FORBIDDEN` com o token estável `LGPD_EXPORT_DISABLED` na mensagem;
 *  - sem payload: nenhum dado pessoal, segredo ou dado institucional é lido ou devolvido;
 *  - idêntica para qualquer ator (usuário sem órgão, viewer, operator, manager, owner, admin de
 *    plataforma, membership ativa ou inativa);
 *  - observável: evento estruturado `lgpd_export_refused` apenas com actorUserId e correlationId.
 *
 * Futuro (NÃO implementado aqui — capability própria, com revisão jurídica/controlador): exportação
 * governada com allowlist explícita, schema de saída estrito (`.output()` Zod `.strict()`), auditoria
 * (`lgpd.export_requested` / `lgpd.export_delivered`) e atendimento pelo controlador (o órgão público).
 * Qualquer reativação NUNCA pode incluir as chaves de `LGPD_EXPORT_FORBIDDEN_KEYS`.
 */
import { TRPCError } from "@trpc/server";
import { serviceLogger } from "./observabilityService";

/** Token estável do desligamento da exportação LGPD (não traduzir; usado por testes/cliente). */
export const LGPD_EXPORT_DISABLED = "LGPD_EXPORT_DISABLED";

/** Mensagem pública (pt-BR), idêntica para qualquer ator. */
export const LGPD_EXPORT_DISABLED_MESSAGE =
  "A exportação de dados pessoais por autoatendimento não está disponível. A solicitação deve ser " +
  "encaminhada ao administrador da sua organização ou ao encarregado pelo tratamento de dados pessoais " +
  `(DPO), para atendimento por processo governado (${LGPD_EXPORT_DISABLED}).`;

/**
 * Chaves que NUNCA podem sair em uma exportação de dados pessoais — nem hoje (desativada) nem em
 * qualquer reativação futura. Segredos/controles de autenticação e referências internas de storage.
 */
export const LGPD_EXPORT_FORBIDDEN_KEYS = [
  "passwordHash", "signaturePassword", "tokenVersion", "openId", "s3Key", "fileUrl",
] as const;

const log = serviceLogger("lgpdExportGuard");

export interface LgpdExportCallContext {
  user?: { id: number } | null;
  correlationId?: string | null;
}

/**
 * Recusa a exportação de dados pessoais por autoatendimento. Deve ser a PRIMEIRA instrução do
 * handler. Só `ctx.user.id` e `ctx.correlationId` são lidos do contexto.
 */
export function throwLgpdExportDisabled(ctx?: LgpdExportCallContext | null): never {
  log.warn("lgpd_export_refused", {
    actorUserId: ctx?.user?.id ?? null,
    correlationId: ctx?.correlationId ?? null,
  });
  throw new TRPCError({ code: "FORBIDDEN", message: LGPD_EXPORT_DISABLED_MESSAGE });
}
