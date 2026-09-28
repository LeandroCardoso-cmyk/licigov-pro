/**
 * R3 / PR-06 (SEM-007) — Create ≠ Reset para o CONTRATO canônico (`contract_workspaces`).
 *
 * Chave natural = o `id` determinístico hash(org, originType, contractNumber) de `createContractWorkspace`. Antes, os
 * quatro fluxos de nascimento gravavam por upsert: um contrato VIGENTE voltava a "minuta" com contratado/objeto/valor/
 * prazo de outra criação (mantendo o processo de origem antigo), e o 2º import externo sem número ("IMPORTADO")
 * sobrescrevia o 1º. Agora a criação é INSERT-only; sobre chave existente:
 *  - retry idempotente da MESMA criação (mesmo ator + mesmo payload normalizado + contrato ainda "minuta") ⇒ converge,
 *    devolvendo o existente SEM escrita;
 *  - qualquer outra coisa ⇒ CONFLICT com mensagem pt-BR estável e o token `CONTRACT_ALREADY_EXISTS`.
 * Pura e determinística (sem DB).
 */
import type { ContractOriginType, ContractWorkspace } from "./contractWorkspace";

/** Token estável (não traduzir; usado por testes e cliente). */
export const CONTRACT_ALREADY_EXISTS = "CONTRACT_ALREADY_EXISTS";

const ORIGIN_LABEL: Record<ContractOriginType, string> = {
  processo_licitatorio: "do Processo Licitatório",
  contratacao_direta: "da Contratação Direta",
  externo: "externo (importado)",
  avulso: "avulso",
};

/**
 * Mensagem do CONFLICT. Inclui "(id: …)" em formato parseável pelo cliente para oferecer "abrir o contrato existente"
 * (mesma convenção pré-existente do contrato avulso — o projeto não tem errorFormatter que leve `cause` ao cliente).
 */
export function contractAlreadyExistsMessage(existing: Pick<ContractWorkspace, "id" | "originType" | "contractNumber">): string {
  return `Já existe um contrato ${ORIGIN_LABEL[existing.originType]} com o número "${existing.contractNumber}" nesta organização. ` +
    `A criação não altera o contrato existente (${CONTRACT_ALREADY_EXISTS}). (id: ${existing.id})`;
}

const cents = (v: number) => Math.round(Number(v) * 100);

/**
 * Retry idempotente da MESMA criação. `createdBy` precisa estar presente e igual nos dois (linhas antigas sem ator
 * nunca convergem — fail-closed). Campos comparados = tudo o que a criação grava; o estado precisa ser o que a
 * criação produz ("minuta").
 */
export function isSameContractCreate(existing: ContractWorkspace, candidate: ContractWorkspace): boolean {
  return existing.id === candidate.id
    && existing.organizationId === candidate.organizationId
    && existing.status === "minuta"
    && existing.createdBy != null
    && existing.createdBy === candidate.createdBy
    && existing.originType === candidate.originType
    && existing.originProcess === candidate.originProcess
    && existing.contractNumber === candidate.contractNumber
    && existing.contractor === candidate.contractor
    && existing.object === candidate.object
    && cents(existing.value) === cents(candidate.value)
    && existing.term === candidate.term
    && existing.manager === candidate.manager
    && existing.inspector === candidate.inspector;
}

export type ContractCreateDecision = { readonly kind: "converge" } | { readonly kind: "conflict" };

export function decideContractCreateOnExisting(existing: ContractWorkspace, candidate: ContractWorkspace): ContractCreateDecision {
  return isSameContractCreate(existing, candidate) ? { kind: "converge" } : { kind: "conflict" };
}
