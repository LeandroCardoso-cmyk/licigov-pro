/**
 * R3 / PR-06 (SEM-007) — Create ≠ Reset para o CONTRATO canônico (`contract_workspaces`).
 *
 * Chave institucional (decisão do responsável, pós night-shift): o NÚMERO OFICIAL do contrato é ÚNICO POR ORGANIZAÇÃO,
 * QUALQUER QUE SEJA A ORIGEM (Processo Licitatório, Contratação Direta, avulso/manual, importado). A chave é
 * (organização, número normalizado) — ver `normalizeContractNumber`; a origem NÃO faz parte dela. O `id` continua
 * determinístico hash(org, originType, número normalizado) (identidade técnica da linha, inalterada), mas quem decide a
 * unicidade é a chave institucional: checagem no servidor antes do INSERT + UNIQUE(organization_id, normalized_number)
 * no banco (migration 0310, coluna gerada). Antes, os quatro fluxos de nascimento gravavam por upsert: um contrato
 * VIGENTE voltava a "minuta" com contratado/objeto/valor/prazo de outra criação, e o 2º import externo sem número
 * ("IMPORTADO") sobrescrevia o 1º. Agora a criação é INSERT-only; sobre número já existente na organização:
 *  - retry idempotente da MESMA criação (mesma origem + mesmo ator + mesmo payload normalizado + contrato ainda
 *    "minuta") ⇒ converge, devolvendo o existente SEM escrita;
 *  - qualquer outra coisa (inclusive o mesmo número vindo de OUTRA origem, ou o contrato já fora de "minuta") ⇒
 *    CONFLICT com mensagem pt-BR estável e o token `CONTRACT_ALREADY_EXISTS`.
 * Pura e determinística (sem DB).
 */
import type { ContractOriginType, ContractWorkspace } from "./contractWorkspace";

/** Token estável (não traduzir; usado por testes e cliente). */
export const CONTRACT_ALREADY_EXISTS = "CONTRACT_ALREADY_EXISTS";
/** Número do contrato vazio após a normalização (só espaços) — recusado antes de qualquer escrita. */
export const CONTRACT_NUMBER_REQUIRED = "CONTRACT_NUMBER_REQUIRED";

/**
 * Normalização do número oficial do contrato — DETERMINÍSTICA e MÍNIMA: remove SOMENTE o espaço em branco das pontas
 * (`String.prototype.trim`, a mesma regra já usada pelo código na extração do número em `contractReconstruction`).
 * NÃO altera caixa, NÃO remove zeros à esquerda, NÃO reinterpreta ano/separadores ("CT-01/2026" ≠ "CT-1/26"), NÃO
 * troca pontuação: o significado do número é preservado. O valor normalizado é o que se grava em `contract_number` na
 * criação; a coluna gerada `normalized_number` = NULLIF(TRIM(contract_number), '') em colação binária (0310) aplica a
 * mesma regra no banco (para linhas gravadas pelo sistema, TRIM(número já normalizado) é a identidade).
 */
export function normalizeContractNumber(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

export const CONTRACT_NUMBER_REQUIRED_MESSAGE =
  `Informe o número do contrato — o número não pode ficar em branco (${CONTRACT_NUMBER_REQUIRED}).`;

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
  return `${contractNumberTakenText(existing)} (id: ${existing.id})`;
}

/** Texto do CONFLICT sem o sufixo "(id: …)" — o fluxo avulso anexa o id no router (convenção pré-existente). */
export function contractNumberTakenText(existing: Pick<ContractWorkspace, "originType" | "contractNumber">): string {
  return `Já existe um contrato ${ORIGIN_LABEL[existing.originType]} com o número "${existing.contractNumber}" nesta organização. ` +
    `O número do contrato é único na organização, qualquer que seja a origem; a criação não altera o contrato existente ` +
    `(${CONTRACT_ALREADY_EXISTS}).`;
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
