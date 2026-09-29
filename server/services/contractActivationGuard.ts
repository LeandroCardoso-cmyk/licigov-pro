/**
 * NEW-022 (P1 authority/lifecycle) — bloqueio da ATIVAÇÃO do contrato pelo editor genérico.
 *
 * `contractWorkspace.updateContract` é um editor genérico de campos. Ele permitia `minuta → vigente` — o ato
 * que torna o contrato institucionalmente vigente — sem evidência de formalização, sem comando dedicado,
 * sem evento dedicado, sem idempotência específica e sem autoridade contextual (mesmo com o piso técnico
 * manager+ da NEW-006). Até existir um comando GOVERNADO de ativação, este caminho fica BLOQUEADO:
 *  - recusa determinística `FORBIDDEN` com o token estável `CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION`,
 *    idêntica para qualquer papel;
 *  - ANTES de qualquer escrita: nada é gravado (nem os demais campos do mesmo pedido), nenhum evento de
 *    timeline de sucesso, nenhuma mudança de status;
 *  - tenant-scoped: contrato de outro órgão continua `NOT_FOUND` neutro (leitura escopada ao órgão do
 *    contexto autenticado);
 *  - observável: evento estruturado `contract_generic_activation_refused` (actorUserId, organizationId,
 *    contractId, correlationId — sem PII).
 *
 * Seguro contra corrida: nenhuma transição leva de volta a `minuta` (STATUS_TRANSITIONS), então um contrato
 * lido fora de `minuta` nunca volta a ser ativável por este caminho entre a leitura do guard e a do handler.
 *
 * O que este guard NÃO faz: não implementa a ativação oficial, não define o que é "formalização" nem cria
 * requisito jurídico. A proposta técnica (PROPOSTA — NÃO DEFINIDA JURIDICAMENTE) está em
 * `docs/design/CONTRACT_ACTIVATION_TRANSITION.md` (branch da PR-08).
 */
import { TRPCError } from "@trpc/server";
import { getContractWorkspace } from "../db/contractWorkspace";
import { serviceLogger } from "./observabilityService";

/** Token estável da recusa (não traduzir; usado por testes/cliente). */
export const CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION = "CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION";

/** Mensagem pública (pt-BR), idêntica para qualquer ator. */
export const CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION_MESSAGE =
  "A ativação do contrato (minuta → vigente) não pode ser feita pela edição genérica: ela exige uma ação " +
  `governada própria, ainda não disponível. Nenhuma alteração foi gravada (${CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION}).`;

const log = serviceLogger("contractActivationGuard");

/** Pura: o pedido é a ATIVAÇÃO do contrato (`minuta → vigente`)? */
export function isGenericContractActivation(fromStatus: string, toStatus: string | undefined | null): boolean {
  return fromStatus === "minuta" && toStatus === "vigente";
}

export interface GenericActivationCallContext {
  user?: { id: number } | null;
  correlationId?: string | null;
}

/**
 * Recusa a ativação pelo editor genérico. Só lê o contrato quando o pedido traz `status: "vigente"`;
 * contrato inexistente/de outro órgão ⇒ `NOT_FOUND` neutro (mesma mensagem do handler).
 */
export async function assertNoGenericContractActivation(
  input: { contractId: string; status?: string | null },
  organizationId: number,
  ctx?: GenericActivationCallContext | null,
): Promise<void> {
  if (input.status !== "vigente") return;
  const ws = await getContractWorkspace(input.contractId, organizationId);
  if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado nesta organização." });
  if (!isGenericContractActivation(ws.status, input.status)) return;
  log.warn("contract_generic_activation_refused", {
    actorUserId: ctx?.user?.id ?? null,
    organizationId,
    contractId: input.contractId,
    correlationId: ctx?.correlationId ?? null,
  });
  throw new TRPCError({ code: "FORBIDDEN", message: CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION_MESSAGE });
}
